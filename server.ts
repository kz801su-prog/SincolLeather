import express, { Request, Response } from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MySQL Connection Pool
let pool: mysql.Pool | null = null;

const getPool = () => {
  if (!pool) {
    let host = process.env.MYSQL_HOST || 'localhost';
    
    // Sanitize host: strip protocol and paths if user accidentally pasted a URL
    if (host.includes('://')) {
      try {
        const url = new URL(host);
        host = url.hostname;
        console.warn(`[MySQL] Host was provided as a URL. Sanitized to: ${host}`);
      } catch (e) {
        // Fallback: manual strip if URL parsing fails
        host = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
      }
    }

    const config = {
      host,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'board_db',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
    };
    console.log('Initializing MySQL Pool with:', { ...config, password: '***' });
    pool = mysql.createPool(config);
  }
  return pool;
};

// Initialize Tables
async function initDb() {
  try {
    const p = getPool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uuid VARCHAR(255) UNIQUE NOT NULL,
        title VARCHAR(255),
        date VARCHAR(50),
        department VARCHAR(255),
        project VARCHAR(255),
        responsible_person VARCHAR(255),
        status VARCHAR(50),
        priority VARCHAR(50),
        goal TEXT,
        start_date VARCHAR(50),
        due_date VARCHAR(50),
        is_committed BOOLEAN DEFAULT FALSE,
        is_soft_deleted BOOLEAN DEFAULT FALSE,
        reviewer VARCHAR(255),
        parent_id VARCHAR(255),
        hierarchy_type VARCHAR(50),
        track_id VARCHAR(255),
        team_json JSON,
        progress_json JSON,
        milestones_json JSON,
        comments_json JSON,
        attachments_json JSON,
        dependencies_json JSON,
        last_viewed_by_json JSON,
        evaluation_json JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS project_concept (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255),
        content TEXT,
        attachments_json JSON,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await p.query(`
      CREATE TABLE IF NOT EXISTS epics (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('MySQL Tables initialized successfully');
  } catch (error) {
    console.error('Failed to initialize MySQL tables:', error);
    console.warn('MySQL functionality might be disabled if connection fails.');
  }
}

// API Routes
app.post('/api/mysql/save-task', async (req: Request, res: Response) => {
  try {
    const task = req.body;
    const p = getPool();
    
    const query = `
      INSERT INTO tasks (
        uuid, title, date, department, project, responsible_person, 
        status, priority, goal, start_date, due_date, is_committed, 
        is_soft_deleted, reviewer, parent_id, hierarchy_type, track_id,
        team_json, progress_json, milestones_json, comments_json, 
        attachments_json, dependencies_json, last_viewed_by_json, evaluation_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title=VALUES(title), date=VALUES(date), department=VALUES(department), 
        project=VALUES(project), responsible_person=VALUES(responsible_person),
        status=VALUES(status), priority=VALUES(priority), goal=VALUES(goal),
        start_date=VALUES(start_date), due_date=VALUES(due_date), 
        is_committed=VALUES(is_committed), is_soft_deleted=VALUES(is_soft_deleted),
        reviewer=VALUES(reviewer), parent_id=VALUES(parent_id), 
        hierarchy_type=VALUES(hierarchy_type), track_id=VALUES(track_id),
        team_json=VALUES(team_json), progress_json=VALUES(progress_json),
        milestones_json=VALUES(milestones_json), comments_json=VALUES(comments_json),
        attachments_json=VALUES(attachments_json), dependencies_json=VALUES(dependencies_json),
        last_viewed_by_json=VALUES(last_viewed_by_json), evaluation_json=VALUES(evaluation_json)
    `;

    const values = [
      task.uuid, task.title, task.date, task.department, task.project, task.responsiblePerson,
      task.status, task.priority, task.goal, task.startDate, task.dueDate, task.isCommitted,
      task.isSoftDeleted, task.reviewer, task.parentId, task.hierarchyType, task.trackId,
      JSON.stringify(task.team || []), JSON.stringify(task.progress || []), 
      JSON.stringify(task.milestones || []), JSON.stringify(task.comments || []),
      JSON.stringify(task.attachments || []), JSON.stringify(task.dependencies || []),
      JSON.stringify(task.lastViewedBy || []), JSON.stringify(task.evaluation || null)
    ];

    await p.query(query, values);
    res.json({ status: 'success' });
  } catch (error: any) {
    console.error('MySQL Save Task Error:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/api/mysql/save-concept', async (req: Request, res: Response) => {
  try {
    const concept = req.body;
    const p = getPool();
    await p.query(`
      INSERT INTO project_concept (id, name, content, attachments_json)
      VALUES (1, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name=VALUES(name), content=VALUES(content), attachments_json=VALUES(attachments_json)
    `, [concept.name, concept.content, JSON.stringify(concept.attachments || [])]);
    res.json({ status: 'success' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

app.post('/api/mysql/save-epics', async (req: Request, res: Response) => {
  try {
    const { epics } = req.body;
    const p = getPool();
    // Simple implementation: clear and re-insert or just insert new ones
    // For now, let's just insert new ones
    for (const name of epics) {
      await p.query('INSERT IGNORE INTO epics (name) VALUES (?)', [name]);
    }
    res.json({ status: 'success' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Vite Integration
async function startServer() {
  await initDb();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
