const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./kdp.db');

db.serialize(() => {
  // Create users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT
  )`);

  // Create artworks table
  db.run(`CREATE TABLE IF NOT EXISTS artworks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    description TEXT,
    price REAL,
    imageUrl TEXT,
    authorId INTEGER,
    FOREIGN KEY (authorId) REFERENCES users(id)
  )`);
});

module.exports = db;
