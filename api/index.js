const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

// Helper: Create OAuth2 client
function createOAuth2Client(tokens) {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
  );

  if (tokens) {
    oAuth2Client.setCredentials(tokens);
  }

  return oAuth2Client;
}

// Home route
router.get('/', (req, res) => {
  res.send('<h2>Gmail Inbox Viewer</h2><a href="/auth/google">Open Inbox</a>');
});

// Google OAuth
router.get('/auth/google', (req, res) => {
  const oAuth2Client = createOAuth2Client();
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });

  res.redirect(authUrl);
});

// OAuth Callback
router.get('/oauth2callback', async (req, res) => {
  try {
    const code = req.query.code;
    const oAuth2Client = createOAuth2Client();

    const { tokens } = await oAuth2Client.getToken(code);
    req.session.tokens = tokens;
    oAuth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const messagesList = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 10,
    });

    const messages = messagesList.data.messages || [];

    const messageSummaries = await Promise.all(
      messages.map(async (msg) => {
        const msgDetail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });

        const headers = msgDetail.data.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
        const from = headers.find(h => h.name === 'From')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        return `<li><strong>${subject}</strong> <br/> From: ${from} | Date: ${date} <br/><a href="/message/${msg.id}">View Full</a></li><hr/>`;
      })
    );

    res.send(`<h3>Inbox:</h3><ul>${messageSummaries.join('')}</ul>`);

  } catch (err) {
    console.error('OAuth2 error:', err);
    res.status(500).send('Failed to load inbox');
  }
});

// Middleware to protect route
function ensureAuthenticated(req, res, next) {
  if (!req.session?.tokens) {
    return res.status(401).send('Login required. <a href="/auth/google">Login</a>');
  }
  next();
}

// View full message
router.get('/message/:id', ensureAuthenticated, async (req, res) => {
  try {
    const oAuth2Client = createOAuth2Client(req.session.tokens);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const msgDetail = await gmail.users.messages.get({
      userId: 'me',
      id: req.params.id,
      format: 'full',
    });

    const headers = msgDetail.data.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
    const from = headers.find(h => h.name === 'From')?.value || '';
    const date = headers.find(h => h.name === 'Date')?.value || '';

    function decodeBase64(str) {
      return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    }

    function extractBody(part) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64(part.body.data);
      } else if (part.parts?.length) {
        for (let p of part.parts) {
          const result = extractBody(p);
          if (result) return result;
        }
      }
      return null;
    }

    const body = extractBody(msgDetail.data.payload) || decodeBase64(msgDetail.data.payload?.body?.data || '');

    res.send(`
      <h3>${subject}</h3>
      <p><strong>From:</strong> ${from}</p>
      <p><strong>Date:</strong> ${date}</p>
      <hr/>
      ${body}
      <br/><br/>
      <a href="/">← Back to Inbox</a>
    `);
  } catch (err) {
    console.error('Message error:', err);
    res.status(500).send('Failed to load message.');
  }
});

router.get('/favicon.ico', (req, res) => res.status(204).end());

module.exports = router;
