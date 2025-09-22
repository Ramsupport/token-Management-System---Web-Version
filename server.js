// Import required packages
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

// Create the Express app
const app = express();
// Use the port that Railway provides, or 3000 for local development
const PORT = process.env.PORT || 3000;

// Create a new pool of connections to the database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Middleware ---
// This allows the server to understand JSON data sent from the browser
app.use(express.json());
// This serves your main HTML file and other static files (like CSS if you add it)
app.use(express.static(path.join(__dirname)));


// --- API ROUTES ---

// 1. GET all tokens (with filtering)
app.get('/api/tokens', async (req, res) => {
  try {
    // This is the base query
    let query = 'SELECT * FROM tokens';
    const params = [];
    const conditions = [];

    // Check for each filter and add it to the query
    // Example for 'status' filter:
    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`status = $${params.length}`);
    }
    // Example for 'agent' filter:
    if (req.query.agent) {
        params.push(req.query.agent);
        conditions.push(`agent_name = $${params.length}`);
    }
    // TODO: Add more 'if' blocks here for your other filters (location, dates, etc.)

    // If there are any conditions, add them to the query
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY id DESC';

    const client = await pool.connect();
    const result = await client.query(query, params);
    res.json(result.rows);
    client.release();
  } catch (err) {
    console.error('Error fetching tokens:', err);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// TODO: Add your other API endpoints here later. For example:
// app.post('/api/tokens', async (req, res) => { /* Code to add a token */ });
// app.put('/api/tokens/:id', async (req, res) => { /* Code to update a token */ });
// app.delete('/api/tokens/:id', async (req, res) => { /* Code to delete a token */ });
// app.get('/api/agents', async (req, res) => { /* Code to get agents */ });


// --- Start the Server ---
app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
