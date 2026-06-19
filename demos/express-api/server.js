const express = require('express');
const app = express();
const PORT = process.env.PORT || 3100;

app.use(express.json());

// In-memory task store
const tasks = [
  { id: 1, title: 'Set up CI/CD pipeline', status: 'done', assignee: 'agent-alpha' },
  { id: 2, title: 'Write integration tests', status: 'in-progress', assignee: 'agent-beta' },
  { id: 3, title: 'Deploy to staging', status: 'pending', assignee: null },
];
let nextId = 4;

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'demo-express-api', tasks: tasks.length, uptime: process.uptime() });
});

app.get('/tasks', (req, res) => {
  const { status } = req.query;
  const filtered = status ? tasks.filter(t => t.status === status) : tasks;
  res.json({ tasks: filtered, total: filtered.length });
});

app.get('/tasks/:id', (req, res) => {
  const task = tasks.find(t => t.id === parseInt(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.post('/tasks', (req, res) => {
  const { title, assignee } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const task = { id: nextId++, title, status: 'pending', assignee: assignee || null };
  tasks.push(task);
  res.status(201).json(task);
});

app.put('/tasks/:id', (req, res) => {
  const task = tasks.find(t => t.id === parseInt(req.params.id));
  if (!task) return res.status(404).json({ error: 'Task not found' });
  Object.assign(task, req.body);
  res.json(task);
});

app.listen(PORT, () => {
  console.log(`Demo Express API running on http://localhost:${PORT}`);
});
