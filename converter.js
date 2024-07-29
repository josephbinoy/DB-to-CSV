import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import axios from 'axios';
import fs from 'fs/promises';
import { parse } from 'json2csv';

const baseUrl = 'https://osu.ppy.sh/api/v2/';
const dbFilePath = 'your-db-name.db'; 
const client_id = 'your-client-id-here'
const client_secret = 'your-client-secret-here'
let bearerToken = '';

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
                result = players.users.map(player => {
                    return {
                        name: player.username,
                        id: player.id,
                    };
                });
            }
        } else {
            console.error(`Error: Received status code ${response.status}`);
            return {
                artist: 'Error',
                title: 'Error',
            };
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
    return result;
}

async function processDatabase() {
    process.stdout.write('Requesting guest token...');
    bearerToken = await getGuestToken();
    process.stdout.write('\rRequesting guest token... Success!          \n');
    let rows = [];
    const query1 = `
        SELECT BEATMAP_ID, COUNT(*) as PICK_COUNT
        FROM PICKS
        GROUP BY BEATMAP_ID
        ORDER BY PICK_COUNT DESC;
        `;
    const db = await open({
        filename: dbFilePath,
        driver: sqlite3.Database,
    });
    try{
        process.stdout.write('Scanning Database...');
        rows = await db.all(query1);
        process.stdout.write('\rScanning Database... Success!          \n');
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return;
    }
    const totalRows = rows.length;
    const results = [];
    console.log('Fetching beatmap information from bancho...\n');
    for (let i = 0; i < totalRows; i++) {
        const row = rows[i];
        const {artist, title} = await fetchBeatmapAndArtistName(row.BEATMAP_ID);
        results.push({
            beatmapset_id: row.BEATMAP_ID,
            beatmap_name: title,
            artist: artist,
            pick_count: row.PICK_COUNT,
        });
        updateProgressBar(i + 1, totalRows);

        // Rate limiting: wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log('\n');
    console.log('Writing results to CSV...');
    const csv = parse(results);
    await fs.writeFile('overplayed_maps_list.csv', csv);
    const query2 = `SELECT COUNT(DISTINCT PICKER_ID) as plcount FROM PICKS;`;
    const query3 = `SELECT COUNT(DISTINCT BEATMAP_ID) as bcount FROM PICKS;`;
    const query4 = `SELECT COUNT(*) as pcount FROM PICKS;`;
    const query5 = `
        SELECT PICKER_ID, COUNT(*) AS pick_count
        FROM PICKS
        GROUP BY PICKER_ID
        ORDER BY pick_count DESC
        LIMIT 5;
        `;
    console.log('Fetching player information from bancho...');
    try {
        const playerCount = await db.get(query2);
        const beatmapCount = await db.get(query3);
        const picksCount = await db.get(query4);
        const topPickers = await db.all(query5);
        const pickerInfo = await fetchPlayerName(topPickers.map(picker => picker.PICKER_ID));
        console.log(`Printing stats...`);
        console.log(`Total picks: ${picksCount.pcount}`);
        console.log(`Unique players count: ${playerCount.plcount}`);
        console.log(`Unique beatmaps count: ${beatmapCount.bcount}`);
        if (pickerInfo){
            console.log('Top pickers (5 max):');
            for (let i = 0; i < pickerInfo.length; i++){
                console.log(`${i+1}. ${pickerInfo[i].name} (${pickerInfo[i].id}) with ${topPickers[i].pick_count} picks`);
            }
        }
    }
    catch (error) {
        console.error(`Error: ${error.message}`);
        return;
    }
    await db.close();
}

processDatabase();
