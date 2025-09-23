require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database connection with retry logic
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  retryDelay: 5000,
  retryLimit: 5
});

// Password hashing with bcrypt
const hashPassword = async (password) => {
  return await bcrypt.hash(password, 10);
};

const verifyPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

// Initialize database tables with retry logic
async function initializeDatabase() {
  let retries = 5;
  
  while (retries > 0) {
    try {
      console.log('Initializing database...');
      
      // Test connection first
      await pool.query('SELECT 1');
      console.log('✅ Database connection successful');
      
      // Create tables
      await pool.query(`
        CREATE TABLE IF NOT EXISTS tokens (
          id SERIAL PRIMARY KEY, 
          date DATE NOT NULL, 
          completion_date DATE, 
          location VARCHAR(50) NOT NULL, 
          sub_location VARCHAR(100),
          token VARCHAR(100) UNIQUE NOT NULL, 
          password VARCHAR(255), 
          client_name VARCHAR(255) NOT NULL, 
          contact VARCHAR(255),
          who_will_ship VARCHAR(255), 
          contacted_client VARCHAR(100), 
          status VARCHAR(50) DEFAULT 'Not Completed', 
          forwarded VARCHAR(50) DEFAULT 'Not Done',
          charges DECIMAL(10,2) DEFAULT 0, 
          payment_received DECIMAL(10,2) DEFAULT 0, 
          amount_due DECIMAL(10,2) DEFAULT 0,
          charges_to_executive DECIMAL(10,2) DEFAULT 0, 
          agent_name VARCHAR(255), 
          executive_name VARCHAR(255) DEFAULT 'Ramnath',
          margin DECIMAL(10,2) DEFAULT 0, 
          process_by VARCHAR(50) DEFAULT 'Doorstep', 
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY, 
          username VARCHAR(50) UNIQUE NOT NULL, 
          password VARCHAR(255) NOT NULL,
          role VARCHAR(20) NOT NULL, 
          status VARCHAR(20) DEFAULT 'Active', 
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS agents (
          id SERIAL PRIMARY KEY, 
          name VARCHAR(255) UNIQUE NOT NULL, 
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS executives (
          id SERIAL PRIMARY KEY, 
          name VARCHAR(255) UNIQUE NOT NULL, 
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
      
      // Create default users only if the table is empty
      const userCheck = await pool.query('SELECT COUNT(*) FROM users');
      if (parseInt(userCheck.rows[0].count) === 0) {
        console.log('No users found. Creating default users...');
        const defaultUsers = [
            { username: 'admin', password: 'admin123', role: 'Admin' },
            { username: 'user', password: 'user123', role: 'User' },
            { username: 'agent', password: 'agent123', role: 'Agent' },
            { username: 'executive', password: 'executive123', role: 'Executive' }
        ];
        
        for (const user of defaultUsers) {
            const hashedPassword = await hashPassword(user.password);
            await pool.query(
              `INSERT INTO users (username, password, role) VALUES ($1, $2, $3)`, 
              [user.username, hashedPassword, user.role]
            );
        }
        console.log('✅ Default users created successfully.');
      }

      console.log('✅ Database initialized successfully');
      break; // Success, exit retry loop
      
    } catch (error) {
      retries--;
      console.error(`❌ Database initialization failed. Retries left: ${retries}`, error.message);
      
      if (retries === 0) {
        console.error('❌ Could not connect to database after multiple attempts');
        throw error;
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// ===== DEBUG ENDPOINTS =====
app.get('/api/debug/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, status FROM users ORDER BY id');
    res.json({ users: result.rows });
  } catch (error) { 
    console.error('Debug users error:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.post('/api/debug/reset-db', async (req, res) => {
  try {
    await pool.query('DROP TABLE IF EXISTS tokens, users, agents, executives CASCADE');
    await initializeDatabase();
    res.json({ message: 'Database reset successfully' });
  } catch (error) { 
    console.error('Reset DB error:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.get('/api/debug/test', (req, res) => {
  res.json({ message: 'Debug endpoint is working!', status: 'OK', timestamp: new Date().toISOString() });
});

// ===== LOGIN ROUTE =====
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = userResult.rows[0];
    
    // Verify password with bcrypt
    const isValidPassword = await verifyPassword(password, user.password);
    
    if (isValidPassword) {
      return res.json({ 
        message: 'Login successful', 
        username: user.username, 
        role: user.role 
      });
    }

    // Legacy password migration for default users
    const defaultPasswords = {
      'admin': 'admin123', 
      'user': 'user123', 
      'agent': 'agent123', 
      'executive': 'executive123'
    };
    
    if (defaultPasswords[username] === password) {
      const newHashedPassword = await hashPassword(password);
      await pool.query('UPDATE users SET password = $1 WHERE username = $2', [newHashedPassword, username]);
      return res.json({ 
        message: 'Login successful (password migrated)', 
        username: user.username, 
        role: user.role 
      });
    }

    return res.status(401).json({ error: 'Invalid username or password' });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== TOKEN MANAGEMENT ROUTES =====
app.get('/api/tokens', async (req, res) => {
  try { 
    const result = await pool.query('SELECT * FROM tokens ORDER BY created_at DESC'); 
    res.json(result.rows); 
  } catch (error) { 
    console.error('Get tokens error:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.post('/api/tokens', async (req, res) => {
  try {
    const { 
      date, completionDate, location, subLocation, token, password, clientName, 
      contact, whoWillShip, contactedClient, status, forwarded, charges, 
      paymentReceived, amountDue, chargesToExecutive, agentName, executiveName, 
      margin, processBy 
    } = req.body;

    const result = await pool.query(
      `INSERT INTO tokens (
        date, completion_date, location, sub_location, token, password, client_name, 
        contact, who_will_ship, contacted_client, status, forwarded, charges, 
        payment_received, amount_due, charges_to_executive, agent_name, executive_name, 
        margin, process_by, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP) 
      RETURNING *`, 
      [
        date, completionDate, location, subLocation, token, password, clientName,
        contact, whoWillShip, contactedClient, status, forwarded, charges,
        paymentReceived, amountDue, chargesToExecutive, agentName, executiveName,
        margin, processBy
      ]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) { 
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Token already exists' });
    }
    console.error('Create token error:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.put('/api/tokens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      date, completionDate, location, subLocation, token, password, clientName,
      contact, whoWillShip, contactedClient, status, forwarded, charges,
      paymentReceived, amountDue, chargesToExecutive, agentName, executiveName,
      margin, processBy 
    } = req.body;

    const result = await pool.query(
      `UPDATE tokens SET 
        date = $1, completion_date = $2, location = $3, sub_location = $4, 
        token = $5, password = $6, client_name = $7, contact = $8, 
        who_will_ship = $9, contacted_client = $10, status = $11, 
        forwarded = $12, charges = $13, payment_received = $14, 
        amount_due = $15, charges_to_executive = $16, agent_name = $17, 
        executive_name = $18, margin = $19, process_by = $20, 
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = $21 RETURNING *`, 
      [
        date, completionDate, location, subLocation, token, password, clientName,
        contact, whoWillShip, contactedClient, status, forwarded, charges,
        paymentReceived, amountDue, chargesToExecutive, agentName, executiveName,
        margin, processBy, id
      ]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) { 
    console.error('Update token error:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.delete('/api/tokens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tokens WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Token not found' });
    }
    
    res.json({ message: 'Token deleted successfully' });
  } catch (error) { 
    console.error('Delete token error:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

// ===== USER MANAGEMENT ROUTES =====
app.get('/api/users', async (req, res) => {
  try { 
    const result = await pool.query('SELECT id, username, role, status FROM users ORDER BY id'); 
    res.json(result.rows); 
  } catch (error) { 
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Username, password, and role are required' });
    }

    const hashedPassword = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (username, password, role) VALUES ($1, $2, $3) 
       RETURNING id, username, role, status`, 
      [username, hashedPassword, role]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) { 
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

// ===== PASSWORD MANAGEMENT =====
app.put('/api/users/change-password', async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    
    if (!username || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const isCurrentPasswordValid = await verifyPassword(currentPassword, user.password);
    
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ error: 'Incorrect current password' });
    }

    const newHashedPassword = await hashPassword(newPassword);
    await pool.query('UPDATE users SET password = $1 WHERE username = $2', [newHashedPassword, username]);
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== AGENTS API ROUTES =====
app.get('/api/agents', async (req, res) => {
  try { 
    const result = await pool.query('SELECT * FROM agents ORDER BY name'); 
    res.json(result.rows); 
  } catch (error) { 
    console.error('Get agents error:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Agent name is required' });
    }

    const result = await pool.query('INSERT INTO agents (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Agent name already exists' });
    }
    console.error('Create agent error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== EXECUTIVES API ROUTES =====
app.get('/api/executives', async (req, res) => {
  try { 
    const result = await pool.query('SELECT * FROM executives ORDER BY name'); 
    res.json(result.rows); 
  } catch (error) { 
    console.error('Get executives error:', error);
    res.status(500).json({ error: 'Internal server error' }); 
  }
});

app.post('/api/executives', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Executive name is required' });
    }

    const result = await pool.query('INSERT INTO executives (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Executive name already exists' });
    }
    console.error('Create executive error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== SERVER ROUTES =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await pool.query('SELECT 1');
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(), 
      database: 'Connected',
      message: 'Server is running correctly' 
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      timestamp: new Date().toISOString(),
      database: 'Disconnected',
      message: 'Database connection failed' 
    });
  }
});

app.get('/api/test-login', (req, res) => {
  res.json({ 
    message: 'Use these default credentials to login:',
    credentials: [
      { username: 'admin', password: 'admin123', role: 'Admin' },
      { username: 'user', password: 'user123', role: 'User' },
      { username: 'agent', password: 'agent123', role: 'Agent' },
      { username: 'executive', password: 'executive123', role: 'Executive' }
    ],
    note: 'Passwords are case-sensitive. Old passwords will be automatically migrated.'
  });
});

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found', 
    requestedUrl: req.originalUrl,
    availableEndpoints: [
      'GET  /health',
      'GET  /api/debug/users',
      'GET  /api/debug/test',
      'POST /api/debug/reset-db',
      'GET  /api/tokens',
      'POST /api/tokens',
      'PUT  /api/tokens/:id',
      'DELETE /api/tokens/:id',
      'GET  /api/users',
      'POST /api/users',
      'DELETE /api/users/:id',
      'POST /api/login',
      'GET  /api/test-login'
    ] 
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 Token Management System Server Started');
    console.log('='.repeat(60));
    console.log(`📡 Server running on port ${port}`);
    console.log(`🌐 Local: http://localhost:${port}`);
    console.log(`🔧 Health check: http://localhost:${port}/health`);
    console.log('\n👤 Default Login Credentials:');
    console.log('   📋 admin / admin123 (Admin)');
    console.log('   📋 user / user123 (User)');
    console.log('   📋 agent / agent123 (Agent)');
    console.log('   📋 executive / executive123 (Executive)');
    console.log('='.repeat(60) + '\n');
  });
}).catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});