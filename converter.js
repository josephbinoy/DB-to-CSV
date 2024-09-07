import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import axios from 'axios';
import fs from 'fs/promises';
import { parse } from 'csv-parse'
import { stringify } from 'csv-stringify';
import readline from 'readline';

const baseUrl = 'https://osu.ppy.sh/api/v2/';
const dbFilePath = '';
const oldCsvPath = '';
const client_id = ''
const client_secret = ''
let bearerToken = '';
let minPickCount = 0;

async function getGuestToken() {
    try {
        const response = await axios.post('https://osu.ppy.sh/oauth/token', {
            grant_type: 'client_credentials',
            client_id: client_id,
            client_secret: client_secret,
            scope: 'public'
        });

        if (response.status == 200) {
            if (response.data) {
                process.stdout.write('\rRequesting guest token... Success!          \n');
                return response.data.access_token;
            } else {
                return '';
            }
        } else {
            console.error(`Error: Received status code ${response.status}`);
            return '';
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return '';
    }
}

function updateProgressBar(current, total) {
    const barWidth = 50;
    const progress = (current / total) * barWidth;
    const progressBar = '█'.repeat(Math.round(progress)) + ' '.repeat(barWidth - Math.round(progress));
    process.stdout.write(`\r[${progressBar}] ${Math.round((current / total) * 100)}%`);
  }

async function fetchBeatmapAndArtistName(beatmapId) {
  try {
    const url = baseUrl + 'beatmapsets/' + beatmapId;

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
      },
    });

    if (response.status == 200) {
        if (response.data) {
            return {
                artist: response.data.artist,
                title: response.data.title,
            }
        } else {
            return {
                artist: 'Not found',
                title: 'Not found',
            };
        }
    } else {
        console.error(`Error: Received status code ${response.status}`);
        return {
            artist: 'Error',
            title: 'Error',
        };;
    }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return {
            artist: 'Error',
            title: 'Error',
        };
    }
}

async function fetchPlayerName(playerIds) {
    let result=[];
    try {
        const url = baseUrl + 'users?' + playerIds.map(id => `ids[]=${id}`).join('&');
    
        const response = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${bearerToken}`,
          },
        });
    
        const players = response.data;
        if (response.status == 200) {
            if (players.users) {
                const playersMap = new Map(players.users.map(player => [player.id, {
                    name: player.username,
                    id: player.id,
                }]));
                result = playerIds.map(id => playersMap.get(id));
            }
        } else {
            console.error(`Error: Received status code ${response.status}`);
            return null;
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
    return result;
}

async function printStats(db) {
    const query2 = `SELECT COUNT(DISTINCT PICKER_ID) as plcount FROM PICKS;`;
    const query3 = `SELECT COUNT(DISTINCT BEATMAP_ID) as bcount FROM PICKS;`;
    const query4 = `SELECT COUNT(*) as pcount FROM PICKS;`;
    const query5 = `
        SELECT PICKER_ID, COUNT(*) AS pick_count
        FROM PICKS
        GROUP BY PICKER_ID
        ORDER BY pick_count DESC
        LIMIT 11;
        `;
    const query6 = `
        SELECT PICKER_ID, COUNT(*) as OVERPLAYED_PICK_COUNT
        FROM PICKS
        WHERE BEATMAP_ID IN (
            SELECT BEATMAP_ID
            FROM PICKS
            GROUP BY BEATMAP_ID
            HAVING COUNT(*) >= ${minPickCount}
        )
        GROUP BY PICKER_ID
        ORDER BY OVERPLAYED_PICK_COUNT DESC
        LIMIT 1;
    `;
    const query7 = `
            SELECT PICKER_ID, COUNT(*) as OVERPLAYED_PICK_COUNT
            FROM PICKS
            WHERE BEATMAP_ID IN (
                SELECT BEATMAP_ID
                FROM PICKS
                GROUP BY BEATMAP_ID
                HAVING COUNT(*) = 1 OR COUNT(*) = 2
            )
            GROUP BY PICKER_ID
            ORDER BY OVERPLAYED_PICK_COUNT DESC
            LIMIT 1;
        `;
    try {
        const playerCount = await db.get(query2);
        const beatmapCount = await db.get(query3);
        const picksCount = await db.get(query4);
        const topPickers = await db.all(query5);
        const overplayedPicker = await db.get(query6);
        const underplayedPicker = await db.get(query7);
        const filteredTopPickers = topPickers.filter(picker => picker.PICKER_ID > 0)
        const pickerInfo = await fetchPlayerName(filteredTopPickers.map(picker => picker.PICKER_ID));
        console.log(`\nPrinting stats...`);
        console.log(`\nTotal picks: ${picksCount.pcount}`);
        console.log(`\nUnique players count: ${playerCount.plcount}`);
        console.log(`\nUnique beatmaps count: ${beatmapCount.bcount}`);
        if (pickerInfo){
            console.log('\nTop pickers:');
            for (let i = 0; i < 10; i++){
                if (i >= pickerInfo.length) break;
                console.log(`${i+1}. ${pickerInfo[i].name} (${pickerInfo[i].id}) with ${topPickers[i].pick_count} picks`);
            }
        }
        const specialPickerNames = await fetchPlayerName([overplayedPicker.PICKER_ID, underplayedPicker.PICKER_ID]);
        if (specialPickerNames) {
            console.log(`\nOverplayed picker: ${specialPickerNames[0].name} with ${overplayedPicker.OVERPLAYED_PICK_COUNT} overplayed picks`);
            console.log(`\nUnderplayed picker: ${specialPickerNames[1].name} with ${underplayedPicker.OVERPLAYED_PICK_COUNT} underplayed picks`);
        }
    }
    catch (error) {
        console.error(`Error: ${error.message}`);
        return;
    }
}

async function readCsvAndGenerateMap(){
    if (!oldCsvPath) return null;
    const map = new Map();
    try {
        console.log('Parsing old csv...');
        const oldCsv = await fs.readFile(oldCsvPath, 'utf8');        
        const parser = parse(oldCsv, { columns: true });
    
        await new Promise((resolve, reject) => {
            parser.on('readable', function(){
                let record;
                while (record = parser.read()) {
                    const { beatmapset_id, beatmapset_name, artist } = record;
                    map.set(Number(beatmapset_id), { artist, beatmapset_name });
                }
            });
    
            parser.on('error', function(err){
                console.error(`Error: ${err.message}`);
                reject(err);
            });
    
            parser.on('end', function(){
                resolve();
            });
        });    
        return map;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return null;
    }
}

async function writeToCsv(results){
    try{
        const csvOutput = await new Promise((resolve, reject) => {
            stringify(results, {
                header: true
            }, (err, output) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(output);
                }
            });
        });
        await fs.writeFile('overplayed.csv', csvOutput, 'utf8');
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

async function getUserInput(prompt) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function main() {
    process.stdout.write('Requesting guest token...');
    bearerToken = await getGuestToken();
    let rows = [];
    const userValue = await getUserInput('Enter the minimum pick count to be considered overplayed: ');
    minPickCount = parseInt(userValue, 10);

    if (isNaN(minPickCount)) {
        console.error('Invalid input. Please enter a valid number.');
        return;
    }

    const query1 = `
        SELECT BEATMAP_ID, COUNT(*) as PICK_COUNT
        FROM PICKS
        GROUP BY BEATMAP_ID
        HAVING PICK_COUNT >= ${minPickCount}
        ORDER BY PICK_COUNT DESC;
    `;

    const db = await open({
        filename: dbFilePath,
        driver: sqlite3.Database,
    });

    try{
        process.stdout.write('\nScanning Database...');
        rows = await db.all(query1);
        process.stdout.write('\rScanning Database... Success!          \n');
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return;
    }
    const totalRows = rows.length;
    const results = [];
    const beatmapMap = await readCsvAndGenerateMap();
    if (!beatmapMap) {
        console.log('Old csv couldnt be parsed. Searching only from bancho now. ');
    }
    console.log('Gathering beatmap information...\n');
    for (let i = 0; i < totalRows; i++) {
        const row = rows[i];
        let creator = '';
        let name = '';
        const beatmapId = Number(row.BEATMAP_ID); 
        if (beatmapMap && beatmapMap.has(beatmapId)) {
            ({ artist: creator, beatmapset_name: name } = beatmapMap.get(beatmapId));
        } else {
            ({ artist: creator, title: name } = await fetchBeatmapAndArtistName(beatmapId));
            await new Promise(resolve => setTimeout(resolve, 70));
        }
        results.push({
            beatmapset_id: row.BEATMAP_ID,
            beatmapset_name: name,
            artist: creator,
            pick_count: row.PICK_COUNT,
        });
        updateProgressBar(i + 1, totalRows);
    }
    console.log('\n\nWriting results to CSV...');
    await writeToCsv(results);
    await printStats(db);    
    await db.close();
}

main();