const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Connected to PostgreSQL database');
    release();
  }
});

// Routes

// Get all tokens
app.get('/api/tokens', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tokens ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tokens:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single token
app.get('/api/tokens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM tokens WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new token
app.post('/api/tokens', async (req, res) => {
  try {
    const {
      date,
      completionDate,
      location,
      subLocation,
      token,
      password,
      clientName,
      contact,
      whoWillShip,
      contactedClient,
      status,
      forwarded,
      charges,
      paymentReceived,
      amountDue,
      chargesToExecutive,
      agentName,
      executiveName,
      margin,
      processBy
    } = req.body;

    const result = await pool.query(`
      INSERT INTO tokens (
        date, completion_date, location, sub_location, token, password,
        client_name, contact, who_will_ship, contacted_client, status,
        forwarded, charges, payment_received, amount_due, charges_to_executive,
        agent_name, executive_name, margin, process_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      ) RETURNING *
    `, [
      date, completionDate, location, subLocation, token, password,
      clientName, contact, whoWillShip, contactedClient, status,
      forwarded, charges || 0, paymentReceived || 0, amountDue || 0, chargesToExecutive || 0,
      agentName, executiveName, margin || 0, processBy
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update token
app.put('/api/tokens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      date,
      completionDate,
      location,
      subLocation,
      token,
      password,
      clientName,
      contact,
      whoWillShip,
      contactedClient,
      status,
      forwarded,
      charges,
      paymentReceived,
      amountDue,
      chargesToExecutive,
      agentName,
      executiveName,
      margin,
      processBy
    } = req.body;

    const result = await pool.query(`
      UPDATE tokens SET
        date = $1, completion_date = $2, location = $3, sub_location = $4,
        token = $5, password = $6, client_name = $7, contact = $8,
        who_will_ship = $9, contacted_client = $10, status = $11,
        forwarded = $12, charges = $13, payment_received = $14,
        amount_due = $15, charges_to_executive = $16, agent_name = $17,
        executive_name = $18, margin = $19, process_by = $20
      WHERE id = $21 RETURNING *
    `, [
      date, completionDate, location, subLocation, token, password,
      clientName, contact, whoWillShip, contactedClient, status,
      forwarded, charges || 0, paymentReceived || 0, amountDue || 0, chargesToExecutive || 0,
      agentName, executiveName, margin || 0, processBy, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete token
app.delete('/api/tokens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tokens WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    res.json({ message: 'Token deleted successfully' });
  } catch (error) {
    console.error('Error deleting token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
