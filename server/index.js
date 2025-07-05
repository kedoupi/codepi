const express = require('express');
const cors = require('cors');
const db = require('./database.js');
const app = express();
const port = 3001;

// 中间件
app.use(cors());
app.use(express.json());

// API 端点
app.get('/', (req, res) => {
  res.send('Hello from server!');
});

// 用户注册API
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const sql = 'INSERT INTO users (email, password) VALUES (?, ?)';
  db.run(sql, [email, password], function (err) {
    if (err) {
      return res.status(409).json({ message: 'User already exists' });
    }
    res.status(201).json({
      message: 'User created successfully',
      user: { id: this.lastID, email },
    });
  });
});

// 用户登录API
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const sql = 'SELECT * FROM users WHERE email = ?';
  db.get(sql, [email], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Server error' });
    }
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.password !== password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    res
      .status(200)
      .json({ message: 'Login successful', user: { id: user.id, email: user.email } });
  });
});

// 作品上传API
app.post('/api/artworks', (req, res) => {
  const { title, description, price, imageUrl, userId } = req.body;
  if (!title || !imageUrl || !userId) {
    return res.status(400).json({ message: 'Title, imageUrl, and userId are required' });
  }

  const sql =
    'INSERT INTO artworks (title, description, price, imageUrl, authorId) VALUES (?, ?, ?, ?, ?)';
  db.run(sql, [title, description, price, imageUrl, userId], function (err) {
    if (err) {
      return res.status(500).json({ message: 'Failed to upload artwork' });
    }
    res.status(201).json({
      message: 'Artwork uploaded successfully',
      artwork: { id: this.lastID, ...req.body },
    });
  });
});

// 获取所有作品API (支持分页)
app.get('/api/artworks', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  const dataSql = 'SELECT * FROM artworks LIMIT ? OFFSET ?';
  const countSql = 'SELECT COUNT(*) as count FROM artworks';

  db.all(dataSql, [limit, offset], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Server error' });
    }
    db.get(countSql, [], (err, countRow) => {
      if (err) {
        return res.status(500).json({ message: 'Server error' });
      }
      res.status(200).json({
        artworks: rows,
        total: countRow.count,
        page,
        limit,
      });
    });
  });
});

// 获取单个作品API
app.get('/api/artworks/:id', (req, res) => {
  const sql = 'SELECT * FROM artworks WHERE id = ?';
  db.get(sql, [req.params.id], (err, row) => {
    if (err) {
      return res.status(500).json({ message: 'Server error' });
    }
    if (!row) {
      return res.status(404).json({ message: 'Artwork not found' });
    }
    res.status(200).json(row);
  });
});

// 获取用户作品API
app.get('/api/user/:userId/artworks', (req, res) => {
  const sql = 'SELECT * FROM artworks WHERE authorId = ?';
  db.all(sql, [req.params.userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Server error' });
    }
    res.status(200).json(rows);
  });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
