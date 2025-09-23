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
app.use(express.static('public'));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Simple base64 hashing for new passwords
const simpleHash = (password) => {
  return Buffer.from(password).toString('base64');
};

// Initialize database tables
async function initializeDatabase() {
  try {
    console.log('Initializing database...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tokens (
        id SERIAL PRIMARY KEY, date DATE, completion_date DATE, location VARCHAR(50), sub_location VARCHAR(100),
        token VARCHAR(100) UNIQUE, password VARCHAR(255), client_name VARCHAR(255), contact VARCHAR(255),
        who_will_ship VARCHAR(255), contacted_client VARCHAR(100), status VARCHAR(50), forwarded VARCHAR(50),
        charges DECIMAL(10,2) DEFAULT 0, payment_received DECIMAL(10,2) DEFAULT 0, amount_due DECIMAL(10,2) DEFAULT 0,
        charges_to_executive DECIMAL(10,2) DEFAULT 0, agent_name VARCHAR(255), executive_name VARCHAR(255),
        margin DECIMAL(10,2) DEFAULT 0, process_by VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);

    // Remove unique constraint if it exists (this allows duplicate token numbers)
    try {
      await pool.query('ALTER TABLE tokens DROP CONSTRAINT IF EXISTS tokens_token_key');
      console.log('✅ Unique constraint removed from tokens table');
    } catch (error) {
      console.log('ℹ️ Unique constraint already removed or does not exist');
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE, password VARCHAR(255),
        role VARCHAR(20), status VARCHAR(20) DEFAULT 'Active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);

    // --- ADDED: Create agents and executives tables ---
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS executives (
        id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    
    // --- IMPROVED: Create default users only if the table is completely empty ---
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
            const hashedPassword = simpleHash(user.password);
            await pool.query(`INSERT INTO users (username, password, role) VALUES ($1, $2, $3)`, [user.username, hashedPassword, user.role]);
        }
        console.log('✅ Default users created successfully.');
    }

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
  }
}

// ===== DEBUG ENDPOINTS (Preserved from your original file) =====
app.get('/api/debug/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, role, password FROM users ORDER BY id');
    res.json({ users: result.rows });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.post('/api/debug/reset-db', async (req, res) => {
  try {
    await pool.query('DROP TABLE IF EXISTS tokens, users, agents, executives CASCADE');
    await initializeDatabase();
    res.json({ message: 'Database reset successfully' });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.get('/api/debug/test', (req, res) => {
  res.json({ message: 'Debug endpoint is working!', status: 'OK' });
});

// ===== LOGIN ROUTE (Preserved from your original file) =====
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const user = userResult.rows[0];
    const base64Password = simpleHash(password);
    if (base64Password === user.password) {
      return res.json({ message: 'Login successful', username: user.username, role: user.role });
    }
    const defaultPasswords = {'admin': 'admin123', 'user': 'user123', 'agent': 'agent123', 'executive': 'executive123'};
    if (defaultPasswords[username] === password) {
      const newHashedPassword = simpleHash(password);
      await pool.query('UPDATE users SET password = $1 WHERE username = $2', [newHashedPassword, username]);
      return res.json({ message: 'Login successful (password migrated)', username: user.username, role: user.role });
    }
    return res.status(401).json({ error: 'Invalid username or password' });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== MAIN API ROUTES (TOKENS and USERS) =====
// [Your original Token and User CRUD endpoints are preserved here without changes]
app.get('/api/tokens', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM tokens ORDER BY created_at DESC'); res.json(result.rows); } 
  catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.post('/api/tokens', async (req, res) => {
  try {
    const { date, completionDate, location, subLocation, token, password, clientName, contact, whoWillShip, contactedClient, status, forwarded, charges, paymentReceived, amountDue, chargesToExecutive, agentName, executiveName, margin, processBy } = req.body;
    const result = await pool.query(`INSERT INTO tokens (date, completion_date, location, sub_location, token, password, client_name, contact, who_will_ship, contacted_client, status, forwarded, charges, payment_received, amount_due, charges_to_executive, agent_name, executive_name, margin, process_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP) RETURNING *`, [date, completionDate, location, subLocation, token, password, clientName, contact, whoWillShip, contactedClient, status, forwarded, charges, paymentReceived, amountDue, chargesToExecutive, agentName, executiveName, margin, processBy]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.put('/api/tokens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, completionDate, location, subLocation, token, password, clientName, contact, whoWillShip, contactedClient, status, forwarded, charges, paymentReceived, amountDue, chargesToExecutive, agentName, executiveName, margin, processBy } = req.body;
    const result = await pool.query(`UPDATE tokens SET date = $1, completion_date = $2, location = $3, sub_location = $4, token = $5, password = $6, client_name = $7, contact = $8, who_will_ship = $9, contacted_client = $10, status = $11, forwarded = $12, charges = $13, payment_received = $14, amount_due = $15, charges_to_executive = $16, agent_name = $17, executive_name = $18, margin = $19, process_by = $20, updated_at = CURRENT_TIMESTAMP WHERE id = $21 RETURNING *`, [date, completionDate, location, subLocation, token, password, clientName, contact, whoWillShip, contactedClient, status, forwarded, charges, paymentReceived, amountDue, chargesToExecutive, agentName, executiveName, margin, processBy, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Token not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.delete('/api/tokens/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM tokens WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Token not found' });
    res.json({ message: 'Token deleted successfully' });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.get('/api/users', async (req, res) => {
  try { const result = await pool.query('SELECT id, username, role, status FROM users ORDER BY id'); res.json(result.rows); } 
  catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.post('/api/users', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    const hashedPassword = simpleHash(password);
    const result = await pool.query(`INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role, status`, [username, hashedPassword, role]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});

// --- ADDED: Change Password Endpoint ---
app.put('/api/users/change-password', async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];
    const currentHashedPassword = simpleHash(currentPassword);
    if (currentHashedPassword !== user.password) return res.status(401).json({ error: 'Incorrect current password' });
    const newHashedPassword = simpleHash(newPassword);
    await pool.query('UPDATE users SET password = $1 WHERE username = $2', [newHashedPassword, username]);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== AGENTS API ROUTES (NEW) =====
app.get('/api/agents', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM agents ORDER BY name'); res.json(result.rows); } 
  catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.post('/api/agents', async (req, res) => {
  try {
    const { name } = req.body;
    const result = await pool.query('INSERT INTO agents (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Agent name already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.put('/api/agents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const result = await pool.query('UPDATE agents SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Agent not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.delete('/api/agents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM agents WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Agent not found' });
    res.json({ message: 'Agent deleted successfully' });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});

// ===== EXECUTIVES API ROUTES (NEW) =====
app.get('/api/executives', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM executives ORDER BY name'); res.json(result.rows); } 
  catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.post('/api/executives', async (req, res) => {
  try {
    const { name } = req.body;
    const result = await pool.query('INSERT INTO executives (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Executive name already exists' });
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.put('/api/executives/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const result = await pool.query('UPDATE executives SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Executive not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});
app.delete('/api/executives/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM executives WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Executive not found' });
    res.json({ message: 'Executive deleted successfully' });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
});

// ===== SERVER SETUP (Preserved from your original file) =====
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/health', (req, res) => { res.json({ status: 'OK', timestamp: new Date().toISOString(), message: 'Server is running correctly', endpoints: { health: '/health', debugUsers: '/api/debug/users', debugTest: '/api/debug/test', tokens: '/api/tokens', users: '/api/users', login: '/api/login' } }); });
app.get('/api/test-login', (req, res) => { res.json({ message: 'Use these default credentials to login:', credentials: [{ username: 'admin', password: 'admin123', role: 'Admin' }, { username: 'user', password: 'user123', role: 'User' }, { username: 'agent', password: 'agent123', role: 'Agent' }, { username: 'executive', password: 'executive123', role: 'Executive' }], note: 'Passwords are case-sensitive. Old passwords will be automatically migrated.' }); });
app.use('*', (req, res) => { res.status(404).json({ error: 'Endpoint not found', requestedUrl: req.originalUrl, availableEndpoints: ['GET  /health', 'GET  /api/debug/users', 'GET  /api/debug/test', 'POST /api/debug/reset-db', 'GET  /api/tokens', 'GET  /api/users', 'POST /api/login', 'GET  /api/test-login'] }); });

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 Token Management System Server Started');
    console.log('='.repeat(60));
    console.log(`📡 Server running on port ${port}`);
    console.log(`🌐 Local: http://localhost:${port}`);
    console.log('\n🔧 Available Endpoints:');
    console.log(`   ✅ Health check: http://localhost:${port}/health`);
    console.log(`   🔍 Debug users: http://localhost:${port}/api/debug/users`);
    console.log(`   🧪 Debug test: http://localhost:${port}/api/debug/test`);
    console.log(`   🔑 Test login: http://localhost:${port}/api/test-login`);
    console.log('\n👤 Default Login Credentials:');
    console.log('   📋 admin / admin123 (Admin)');
    console.log('   📋 user / user123 (User)');
    console.log('   📋 agent / agent123 (Agent)');
    console.log('   📋 executive / executive123 (Executive)');
    console.log('\n💡 Note: Passwords will be automatically migrated if needed');
    console.log('='.repeat(60) + '\n');
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