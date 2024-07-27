# DB-to-CSV

## Setup

1. **Clone the Repository**

   Clone the repository to your local machine:

   ```bash
   git clone https://github.com/josephbinoy/DB-to-CSV
   cd DB-to-CSV
   ```
2. Install dependencies
   ```
    npm i
   ```
3. Paste .db file inside DB-to-CSV folder
4. Replace '' with your credentials and db path(just the name of db if you pasted it inside the folder) inside converter.js
   ```
   const dbFilePath = ''
   const client_id = ''
   const client_secret = ''
   ```
5. Run the script
   ```
   node converter.js
   ```
