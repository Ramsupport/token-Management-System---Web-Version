#!/usr/bin/env python3
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for
import sqlite3
import os
import datetime
import csv
import io
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'a-default-secret-key-for-local-dev')

# Database configuration
DATABASE_PATH = os.environ.get('DATABASE_PATH', 'tokens.db')

# vvv ADD THIS LINE HERE vvv
init_database()
# ^^^ ADD THIS LINE HERE ^^^

def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_database():
    """Initialize the database with required tables"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create tokens table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        location TEXT,
        sub_location TEXT,
        token TEXT,
        password TEXT,
        client_name TEXT,
        contact TEXT,
        who_will_ship TEXT,
        contacted_client TEXT,
        status TEXT,
        forwarded TEXT,
        charges TEXT,
        payment_received TEXT,
        amount_due TEXT,
        agent_name TEXT,
        executive_name TEXT,
        charges_to_executive TEXT,
        margin TEXT,
        process_by TEXT,
        completion_date TEXT,
        agent_payment_applied TEXT,
        executive_payment_applied TEXT
    )
    """)
    
    # Create charger_list table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS charger_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location TEXT NOT NULL,
        city_or_country TEXT NOT NULL,
        charges TEXT NOT NULL,
        agent TEXT,
        executive TEXT
    )
    """)
    
    conn.commit()
    conn.close()

@app.route('/')
def index():
    """Main dashboard page"""
    return render_template('index.html')

# vvv ADD THIS CODE BLOCK HERE vvv
@app.route('/health')
def health():
    """Health check endpoint for Railway"""
    return jsonify({'status': 'healthy'})
# ^^^ ADD THIS CODE BLOCK HERE ^^^

@app.route('/api/tokens', methods=['GET', 'POST'])
def handle_tokens():
    """API endpoint for token operations"""
    if request.method == 'GET':
        # Get tokens with optional filtering
        conn = get_db_connection()
        
        # Get filter parameters
        location = request.args.get('location', '')
        status = request.args.get('status', '')
        search = request.args.get('search', '')
        agent = request.args.get('agent', '')
        executive = request.args.get('executive', '')
        from_date = request.args.get('from_date', '')
        to_date = request.args.get('to_date', '')
        
        # Build query
        query = """
            SELECT * FROM tokens WHERE 1=1
        """
        params = []
        
        if location and location != 'All':
            query += " AND LOWER(location) = LOWER(?)"
            params.append(location)
            
        if status and status != 'All':
            query += " AND LOWER(status) = LOWER(?)"
            params.append(status)
            
        if search:
            query += """ AND (
                LOWER(token) LIKE LOWER(?) OR 
                LOWER(client_name) LIKE LOWER(?) OR 
                LOWER(contact) LIKE LOWER(?) OR
                LOWER(sub_location) LIKE LOWER(?)
            )"""
            search_param = f"%{search}%"
            params.extend([search_param, search_param, search_param, search_param])
            
        if agent and agent != 'All':
            query += " AND agent_name = ?"
            params.append(agent)
            
        if executive and executive != 'All':
            query += " AND executive_name = ?"
            params.append(executive)
            
        if from_date and to_date:
            query += """ AND (
                substr(date,7,4) || '-' || substr(date,4,2) || '-' || substr(date,1,2)
                BETWEEN ? AND ?
            )"""
            params.extend([from_date, to_date])
        
        query += " ORDER BY substr(date,7,4) || '-' || substr(date,4,2) || '-' || substr(date,1,2) DESC"
        
        tokens = conn.execute(query, params).fetchall()
        conn.close()
        
        return jsonify([dict(token) for token in tokens])
    
    elif request.method == 'POST':
        # Add new token
        data = request.json
        conn = get_db_connection()
        
        # Calculate amount_due and margin
        try:
            charges = float(data.get('charges', 0))
            payment_received = float(data.get('payment_received', 0))
            charges_to_executive = float(data.get('charges_to_executive', 0))
        except (ValueError, TypeError):
            charges = payment_received = charges_to_executive = 0
            
        amount_due = charges - payment_received
        margin = charges - charges_to_executive
        
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO tokens (
                date, location, sub_location, token, password, client_name, contact,
                who_will_ship, contacted_client, status, forwarded, charges,
                payment_received, amount_due, agent_name, executive_name,
                charges_to_executive, margin, process_by, completion_date,
                agent_payment_applied, executive_payment_applied
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get('date'), data.get('location'), data.get('sub_location'),
            data.get('token'), data.get('password'), data.get('client_name'),
            data.get('contact'), data.get('who_will_ship'), data.get('contacted_client'),
            data.get('status'), data.get('forwarded'), data.get('charges'),
            data.get('payment_received'), str(amount_due), data.get('agent_name'),
            data.get('executive_name'), data.get('charges_to_executive'), str(margin),
            data.get('process_by'), data.get('completion_date'), 'no', 'no'
        ))
        
        token_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'id': token_id})

@app.route('/api/tokens/<int:token_id>', methods=['PUT', 'DELETE'])
def handle_token(token_id):
    """API endpoint for individual token operations"""
    conn = get_db_connection()
    
    if request.method == 'PUT':
        # Update token
        data = request.json
        
        # Calculate amount_due and margin
        try:
            charges = float(data.get('charges', 0))
            payment_received = float(data.get('payment_received', 0))
            charges_to_executive = float(data.get('charges_to_executive', 0))
        except (ValueError, TypeError):
            charges = payment_received = charges_to_executive = 0
            
        amount_due = charges - payment_received
        margin = charges - charges_to_executive
        
        conn.execute("""
            UPDATE tokens SET
                date=?, location=?, sub_location=?, token=?, password=?, client_name=?,
                contact=?, who_will_ship=?, contacted_client=?, status=?, forwarded=?,
                charges=?, payment_received=?, amount_due=?, agent_name=?, executive_name=?,
                charges_to_executive=?, margin=?, process_by=?, completion_date=?
            WHERE id=?
        """, (
            data.get('date'), data.get('location'), data.get('sub_location'),
            data.get('token'), data.get('password'), data.get('client_name'),
            data.get('contact'), data.get('who_will_ship'), data.get('contacted_client'),
            data.get('status'), data.get('forwarded'), data.get('charges'),
            data.get('payment_received'), str(amount_due), data.get('agent_name'),
            data.get('executive_name'), data.get('charges_to_executive'), str(margin),
            data.get('process_by'), data.get('completion_date'), token_id
        ))
        
        conn.commit()
        conn.close()
        return jsonify({'success': True})
        
    elif request.method == 'DELETE':
        # Delete token
        conn.execute('DELETE FROM tokens WHERE id=?', (token_id,))
        conn.commit()
        conn.close()
        return jsonify({'success': True})

@app.route('/api/agents')
def get_agents():
    """Get list of agents"""
    conn = get_db_connection()
    agents = conn.execute("""
        SELECT DISTINCT agent_name 
        FROM tokens 
        WHERE agent_name IS NOT NULL AND agent_name != '' 
        ORDER BY agent_name
    """).fetchall()
    conn.close()
    return jsonify([agent['agent_name'] for agent in agents])

@app.route('/api/executives')
def get_executives():
    """Get list of executives"""
    conn = get_db_connection()
    executives = conn.execute("""
        SELECT DISTINCT executive_name 
        FROM tokens 
        WHERE executive_name IS NOT NULL AND executive_name != '' 
        ORDER BY executive_name
    """).fetchall()
    conn.close()
    return jsonify([exec['executive_name'] for exec in executives])

@app.route('/api/export')
def export_csv():
    """Export tokens to CSV"""
    conn = get_db_connection()
    tokens = conn.execute("SELECT * FROM tokens ORDER BY id").fetchall()
    conn.close()
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write headers
    if tokens:
        writer.writerow(tokens[0].keys())
        
        # Write data
        for token in tokens:
            writer.writerow([token[key] for key in token.keys()])
    
    output.seek(0)
    
    # Create a BytesIO object for sending the file
    csv_bytes = io.BytesIO()
    csv_bytes.write(output.getvalue().encode('utf-8-sig'))
    csv_bytes.seek(0)
    
    return send_file(
        csv_bytes,
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'tokens_export_{datetime.datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
    )

@app.route('/api/reports/agent')
def agent_report():
    """Generate agent payment report"""
    agent = request.args.get('agent')
    status = request.args.get('status', 'All')
    from_date = request.args.get('from_date')
    to_date = request.args.get('to_date')
    
    if not agent:
        return jsonify({'error': 'Agent parameter required'}), 400
    
    conn = get_db_connection()
    
    query = """
        SELECT * FROM tokens 
        WHERE agent_name = ?
        AND completion_date IS NOT NULL 
        AND completion_date != ''
    """
    params = [agent]
    
    if from_date and to_date:
        query += """ AND (
            substr(completion_date,7,4) || '-' || substr(completion_date,4,2) || '-' || substr(completion_date,1,2)
            BETWEEN ? AND ?
        )"""
        params.extend([from_date, to_date])
    
    if status != 'All':
        if status == 'Completed':
            query += " AND status = 'Completed'"
        elif status == 'Incomplete':
            query += " AND status = 'Not Completed'"
    
    query += " ORDER BY substr(completion_date,7,4) || '-' || substr(completion_date,4,2) || '-' || substr(completion_date,1,2) ASC"
    
    tokens = conn.execute(query, params).fetchall()
    conn.close()
    
    return jsonify([dict(token) for token in tokens])

@app.route('/api/reports/executive')
def executive_report():
    """Generate executive payment report"""
    executive = request.args.get('executive')
    status = request.args.get('status', 'All')
    from_date = request.args.get('from_date')
    to_date = request.args.get('to_date')
    
    if not executive:
        return jsonify({'error': 'Executive parameter required'}), 400
    
    conn = get_db_connection()
    
    query = """
        SELECT * FROM tokens 
        WHERE executive_name = ?
        AND completion_date IS NOT NULL 
        AND completion_date != ''
    """
    params = [executive]
    
    if from_date and to_date:
        query += """ AND (
            substr(completion_date,7,4) || '-' || substr(completion_date,4,2) || '-' || substr(completion_date,1,2)
            BETWEEN ? AND ?
        )"""
        params.extend([from_date, to_date])
    
    if status != 'All':
        if status == 'Completed':
            query += " AND status = 'Completed'"
        elif status == 'Incomplete':
            query += " AND status = 'Not Completed'"
    
    query += " ORDER BY substr(completion_date,7,4) || '-' || substr(completion_date,4,2) || '-' || substr(completion_date,1,2) DESC"
    
    tokens = conn.execute(query, params).fetchall()
    conn.close()
    
    return jsonify([dict(token) for token in tokens])

@app.route('/api/bulk-operations', methods=['POST'])
def bulk_operations():
    """Handle bulk operations like payment application"""
    data = request.json
    operation = data.get('operation')
    ids = data.get('ids', [])
    
    if not operation or not ids:
        return jsonify({'error': 'Operation and IDs required'}), 400
    
    conn = get_db_connection()
    
    if operation == 'apply_agent_payment':
        conn.executemany("""
            UPDATE tokens 
            SET agent_payment_applied = 'yes',
                payment_received = charges,
                amount_due = '0'
            WHERE id = ?
        """, [(id,) for id in ids])
        
    elif operation == 'apply_executive_payment':
        conn.executemany("""
            UPDATE tokens 
            SET executive_payment_applied = 'yes',
                charges_to_executive = charges,
                margin = '0'
            WHERE id = ?
        """, [(id,) for id in ids])
        
    elif operation == 'mark_completed':
        current_date = datetime.datetime.now().strftime('%d-%m-%Y')
        conn.executemany("""
            UPDATE tokens 
            SET status = 'Completed',
                completion_date = ?
            WHERE id = ?
        """, [(current_date, id) for id in ids])
        
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'processed': len(ids)})

if __name__ == '__main__':
    # Initialize database on startup
    init_database()
    
    # Run the application
    app.run(host='0.0.0.0', port=5000, debug=False)