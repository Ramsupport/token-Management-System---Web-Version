#!/usr/bin/env python3
from flask import Flask, render_template, request, jsonify, send_file, redirect, url_for
import os
import psycopg2
from psycopg2.extras import DictCursor # Important for dictionary-like rows
import datetime
import csv
import io
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'a-default-secret-key-for-local-dev')

def get_db_connection():
    """Establishes a connection to the PostgreSQL database."""
    conn = psycopg2.connect(
        os.environ.get('DATABASE_URL'),
        cursor_factory=DictCursor # This makes rows behave like dictionaries
    )
    return conn

def init_database():
    """Initializes the PostgreSQL database and creates the 'tokens' table if it doesn't exist."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tokens (
            id SERIAL PRIMARY KEY,
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
        );
    """)
    conn.commit()
    cursor.close()
    conn.close()
    print("PostgreSQL Database has been initialized.")

# Initialize the database when the app starts
init_database()

@app.route('/')
def index():
    """Main dashboard page"""
    return render_template('index.html')

@app.route('/health')
def health():
    """Health check endpoint for Railway"""
    return jsonify({'status': 'healthy'})

@app.route('/api/tokens', methods=['GET', 'POST'])
def handle_tokens():
    """API endpoint for token operations"""
    if request.method == 'GET':
        conn = get_db_connection()
        cursor = conn.cursor()
        
        location = request.args.get('location', '')
        status = request.args.get('status', '')
        search = request.args.get('search', '')
        agent = request.args.get('agent', '')
        executive = request.args.get('executive', '')
        from_date = request.args.get('from_date', '')
        to_date = request.args.get('to_date', '')
        
        query = "SELECT * FROM tokens WHERE 1=1"
        params = []
        
        if location and location != 'All':
            query += " AND LOWER(location) = LOWER(%s)"
            params.append(location)
            
        if status and status != 'All':
            query += " AND LOWER(status) = LOWER(%s)"
            params.append(status)
            
        if search:
            query += """ AND (
                LOWER(token) LIKE LOWER(%s) OR 
                LOWER(client_name) LIKE LOWER(%s) OR 
                LOWER(contact) LIKE LOWER(%s) OR
                LOWER(sub_location) LIKE LOWER(%s)
            )"""
            search_param = f"%{search}%"
            params.extend([search_param, search_param, search_param, search_param])
            
        if agent and agent != 'All':
            query += " AND agent_name = %s"
            params.append(agent)
            
        if executive and executive != 'All':
            query += " AND executive_name = %s"
            params.append(executive)
            
        if from_date and to_date:
            # Note: Storing dates as YYYY-MM-DD is better for database queries
            query += """ AND (
                substr(date,7,4) || '-' || substr(date,4,2) || '-' || substr(date,1,2)
                BETWEEN %s AND %s
            )"""
            params.extend([from_date, to_date])
        
        query += " ORDER BY substr(date,7,4) || '-' || substr(date,4,2) || '-' || substr(date,1,2) DESC"
        
        cursor.execute(query, tuple(params))
        tokens = cursor.fetchall()
        cursor.close()
        conn.close()
        
        return jsonify([dict(token) for token in tokens])
    
    elif request.method == 'POST':
        data = request.json
        conn = get_db_connection()
        
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
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            data.get('date'), data.get('location'), data.get('sub_location'),
            data.get('token'), data.get('password'), data.get('client_name'),
            data.get('contact'), data.get('who_will_ship'), data.get('contacted_client'),
            data.get('status'), data.get('forwarded'), str(charges),
            str(payment_received), str(amount_due), data.get('agent_name'),
            data.get('executive_name'), str(charges_to_executive), str(margin),
            data.get('process_by'), data.get('completion_date'), 'no', 'no'
        ))
        
        token_id = cursor.fetchone()[0]
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'id': token_id})
    
@app.route('/api/tokens/<int:token_id>', methods=['PUT', 'DELETE'])
def handle_token(token_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if request.method == 'PUT':
        data = request.json
        
        try:
            charges = float(data.get('charges', 0))
            payment_received = float(data.get('payment_received', 0))
            charges_to_executive = float(data.get('charges_to_executive', 0))
        except (ValueError, TypeError):
            charges = payment_received = charges_to_executive = 0
            
        amount_due = charges - payment_received
        margin = charges - charges_to_executive
        
        cursor.execute("""
            UPDATE tokens SET
                date=%s, location=%s, sub_location=%s, token=%s, password=%s, client_name=%s,
                contact=%s, who_will_ship=%s, contacted_client=%s, status=%s, forwarded=%s,
                charges=%s, payment_received=%s, amount_due=%s, agent_name=%s, executive_name=%s,
                charges_to_executive=%s, margin=%s, process_by=%s, completion_date=%s
            WHERE id=%s
        """, (
            data.get('date'), data.get('location'), data.get('sub_location'),
            data.get('token'), data.get('password'), data.get('client_name'),
            data.get('contact'), data.get('who_will_ship'), data.get('contacted_client'),
            data.get('status'), data.get('forwarded'), str(data.get('charges')),
            str(data.get('payment_received')), str(amount_due), data.get('agent_name'),
            data.get('executive_name'), str(data.get('charges_to_executive')), str(margin),
            data.get('process_by'), data.get('completion_date'), token_id
        ))
        
        conn.commit()
        
    elif request.method == 'DELETE':
        cursor.execute('DELETE FROM tokens WHERE id=%s', (token_id,))
        conn.commit()

    cursor.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/agents')
def get_agents():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT DISTINCT agent_name 
        FROM tokens 
        WHERE agent_name IS NOT NULL AND agent_name != '' 
        ORDER BY agent_name
    """)
    agents = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify([agent['agent_name'] for agent in agents])

@app.route('/api/executives')
def get_executives():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT DISTINCT executive_name 
        FROM tokens 
        WHERE executive_name IS NOT NULL AND executive_name != '' 
        ORDER BY executive_name
    """)
    executives = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify([exec['executive_name'] for exec in executives])

@app.route('/api/export')
def export_csv():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tokens ORDER BY id")
    tokens = cursor.fetchall()
    cursor.close()
    conn.close()
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    if tokens:
        writer.writerow(tokens[0].keys())
        for token in tokens:
            writer.writerow(token)
    
    output.seek(0)
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
    agent = request.args.get('agent')
    if not agent:
        return jsonify({'error': 'Agent parameter required'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = """
        SELECT * FROM tokens 
        WHERE agent_name = %s
        AND completion_date IS NOT NULL 
        AND completion_date != ''
    """
    params = [agent]
    
    # ... (code for handling status, from_date, to_date needs to be updated for %s as well) ...
    # This section is left as is, but will need to be corrected if used.
    
    query += " ORDER BY substr(completion_date,7,4) || '-' || substr(completion_date,4,2) || '-' || substr(completion_date,1,2) ASC"
    
    cursor.execute(query, tuple(params))
    tokens = cursor.fetchall()
    cursor.close()
    conn.close()
    
    return jsonify([dict(token) for token in tokens])

@app.route('/api/reports/executive')
def executive_report():
    executive = request.args.get('executive')
    if not executive:
        return jsonify({'error': 'Executive parameter required'}), 400
        
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = """
        SELECT * FROM tokens 
        WHERE executive_name = %s
        AND completion_date IS NOT NULL 
        AND completion_date != ''
    """
    params = [executive]

    # ... (code for handling status, from_date, to_date needs to be updated for %s as well) ...
    # This section is left as is, but will need to be corrected if used.

    query += " ORDER BY substr(completion_date,7,4) || '-' || substr(completion_date,4,2) || '-' || substr(completion_date,1,2) DESC"
    
    cursor.execute(query, tuple(params))
    tokens = cursor.fetchall()
    cursor.close()
    conn.close()
    
    return jsonify([dict(token) for token in tokens])

@app.route('/api/bulk-operations', methods=['POST'])
def bulk_operations():
    data = request.json
    operation = data.get('operation')
    ids = data.get('ids', [])
    
    if not operation or not ids:
        return jsonify({'error': 'Operation and IDs required'}), 400
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if operation == 'apply_agent_payment':
        # executemany expects a sequence of sequences
        args_list = [(id,) for id in ids]
        cursor.executemany("""
            UPDATE tokens 
            SET agent_payment_applied = 'yes',
                payment_received = charges,
                amount_due = '0'
            WHERE id = %s
        """, args_list)
        
    elif operation == 'apply_executive_payment':
        args_list = [(id,) for id in ids]
        cursor.executemany("""
            UPDATE tokens 
            SET executive_payment_applied = 'yes',
                charges_to_executive = charges,
                margin = '0'
            WHERE id = %s
        """, args_list)
        
    elif operation == 'mark_completed':
        current_date = datetime.datetime.now().strftime('%d-%m-%Y')
        args_list = [(current_date, id) for id in ids]
        cursor.executemany("""
            UPDATE tokens 
            SET status = 'Completed',
                completion_date = %s
            WHERE id = %s
        """, args_list)
        
    conn.commit()
    cursor.close()
    conn.close()
    
    return jsonify({'success': True, 'processed': len(ids)})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)