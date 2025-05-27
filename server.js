const express = require('express');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();

const app = express();

app.use(cors({
  credentials: true,
}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret_key',
  resave: false,
  saveUninitialized: true,
 cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  },
}));

const gmailRoutes = require('./api/index');
app.use('/', gmailRoutes);

const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });

module.exports = app;
