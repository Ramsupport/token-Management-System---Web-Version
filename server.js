require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Simple password hashing and comparison (fallback when bcryptjs is not available)
const simpleHash = (password) => {
  return Buffer.from(password).toString('base64');
};

const simpleCompare = (plainPassword, hashedPassword) => {
  return simpleHash(plainPassword) === hashedPassword;
};

// Initialize database tables
async function initializeDatabase() {
  try {
    // Create tokens table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tokens (
        id SERIAL PRIMARY KEY,
        date DATE,
        completion_date DATE,
        location VARCHAR(50),
        sub_location VARCHAR(100),
        token VARCHAR(100) UNIQUE,
        password VARCHAR(255),
        client_name VARCHAR(255),
        contact VARCHAR(255),
        who_will_ship VARCHAR(255),
        contacted_client VARCHAR(100),
        status VARCHAR(50),
        forwarded VARCHAR(50),
        charges DECIMAL(10,2) DEFAULT 0,
        payment_received DECIMAL(10,2) DEFAULT 0,
        amount_due DECIMAL(10,2) DEFAULT 0,
        charges_to_executive DECIMAL(10,2) DEFAULT 0,
        agent_name VARCHAR(255),
        executive_name VARCHAR(255),
        margin DECIMAL(10,2) DEFAULT 0,
        process_by VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE,
        password VARCHAR(255),
        role VARCHAR(20),
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default users if they don't exist
    const defaultUsers = [
      { username: 'admin', password: 'admin123', role: 'Admin' },
      { username: 'user', password: 'user123', role: 'User' },
      { username: 'agent', password: 'agent123', role: 'Agent' },
      { username: 'executive', password: 'executive123', role: 'Executive' }
    ];

    for (const user of defaultUsers) {
      // Use simple base64 encoding instead of bcrypt
      const hashedPassword = simpleHash(user.password);
      
      await pool.query(`
        INSERT INTO users (username, password, role) 
        VALUES ($1, $2, $3) 
        ON CONFLICT (username) DO NOTHING
      `, [user.username, hashedPassword, user.role]);
    }

    console.log('Database initialized successfully');
    console.log('Default users created:');
    for (const user of defaultUsers) {
      console.log(`- ${user.username} / ${user.password} (${user.role})`);
    }
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// --- Debug Endpoints ---

// Check if users exist in database
app.get('/api/debug/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, password FROM users ORDER BY id');
    console.log('Users in database:', result.rows);
    res.json({
      message: 'Debug user information',
      users: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset database and recreate default users
app.post('/api/debug/reset-db', async (req, res) => {
  try {
    console.log('Resetting database...');
    await pool.query('DROP TABLE IF EXISTS tokens, users CASCADE');
    await initializeDatabase();
    res.json({ message: 'Database reset successfully' });
  } catch (error) {
    console.error('Error resetting database:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- API Routes for Tokens ---

// Get all tokens
app.get('/api/tokens', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tokens ORDER BY created_at DESC');
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
      date, completionDate, location, subLocation, token, password,
      clientName, contact, whoWillShip, contactedClient, status,
      forwarded, charges, paymentReceived, amountDue, chargesToExecutive,
      agentName, executiveName, margin, processBy
    } = req.body;

    const result = await pool.query(`
      INSERT INTO tokens (
        date, completion_date, location, sub_location, token, password,
        client_name, contact, who_will_ship, contacted_client, status,
        forwarded, charges, payment_received, amount_due, charges_to_executive,
        agent_name, executive_name, margin, process_by, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP
      ) RETURNING *
    `, [
      date, completionDate, location, subLocation, token, password,
      clientName, contact, whoWillShip, contactedClient, status,
      forwarded, charges, paymentReceived, amountDue, chargesToExecutive,
      agentName, executiveName, margin, processBy
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
      date, completionDate, location, subLocation, token, password,
      clientName, contact, whoWillShip, contactedClient, status,
      forwarded, charges, paymentReceived, amountDue, chargesToExecutive,
      agentName, executiveName, margin, processBy
    } = req.body;

    const result = await pool.query(`
      UPDATE tokens SET
        date = $1, completion_date = $2, location = $3, sub_location = $4,
        token = $5, password = $6, client_name = $7, contact = $8,
        who_will_ship = $9, contacted_client = $10, status = $11,
        forwarded = $12, charges = $13, payment_received = $14,
        amount_due = $15, charges_to_executive = $16, agent_name = $17,
        executive_name = $18, margin = $19, process_by = $20,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $21
      RETURNING *
    `, [
      date, completionDate, location, subLocation, token, password,
      clientName, contact, whoWillShip, contactedClient, status,
      forwarded, charges, paymentReceived, amountDue, chargesToExecutive,
      agentName, executiveName, margin, processBy, id
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

// --- API Routes for Users ---

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, status FROM users ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new user
app.post('/api/users', async (req, res) => {
  try {
    const { username, password, role } = req.body;

    const hashedPassword = simpleHash(password);

    const result = await pool.query(`
      INSERT INTO users (username, password, role) 
      VALUES ($1, $2, $3) 
      RETURNING id, username, role, status
    `, [username, hashedPassword, role]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === '23505') { 
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    console.log(`Login attempt for username: ${username}`);

    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    
    if (userResult.rows.length === 0) {
      console.log(`User not found: ${username}`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = userResult.rows[0];
    console.log(`User found: ${user.username}, role: ${user.role}`);

    const isMatch = simpleCompare(password, user.password);
    console.log(`Password match: ${isMatch}`);

    if (!isMatch) {
      console.log(`Password mismatch for user: ${username}`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    console.log(`Login successful for: ${username}`);
    res.json({
      message: 'Login successful',
      username: user.username,
      role: user.role
    });

  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Server Setup ---

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: 'Server is running correctly'
  });
});

// Test default credentials endpoint
app.get('/api/test-login', (req, res) => {
  res.json({
    message: 'Use these default credentials to login:',
    credentials: [
      { username: 'admin', password: 'admin123', role: 'Admin' },
      { username: 'user', password: 'user123', role: 'User' },
      { username: 'agent', password: 'agent123', role: 'Agent' },
      { username: 'executive', password: 'executive123', role: 'Executive' }
    ]
  });
});

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📊 Health check: http://localhost:${port}/health`);
    console.log(`🔍 Debug users: http://localhost:${port}/api/debug/users`);
    console.log(`🔑 Test login info: http://localhost:${port}/api/test-login`);
    console.log('\nDefault login credentials:');
    console.log('admin / admin123 (Admin)');
    console.log('user / user123 (User)');
    console.log('agent / agent123 (Agent)');
    console.log('executive / executive123 (Executive)');
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});