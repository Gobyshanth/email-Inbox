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

// Route: Home link
router.get('/', (req, res) => {
  res.send('<a href="/auth/google">Open Inbox</a>');
});

// Route: Google OAuth Redirect
router.get('/auth/google', (req, res) => {
  const oAuth2Client = createOAuth2Client();
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
  
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });

  res.redirect(authUrl);
});

// Route: OAuth callback
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
      maxResults: 50,
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

        return { id: msg.id, subject, from, date };
      })
    );

    res.json({ messages: messageSummaries });

  } catch (err) {
    console.error('OAuth2 callback error:', err);
    res.status(500).send('Error fetching Gmail inbox.');
  }
});

// Middleware: Ensure user is authenticated
function ensureAuthenticated(req, res, next) {
  if (!req.session?.tokens) {
    return res.status(401).send('Not authenticated. Please <a href="/auth/google">login</a>.');
  }
  next();
}

// Route: Get full message by ID
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

    let body = '';
    const payload = msgDetail.data.payload;

    function decodeBase64(str) {
      return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    }

    // Recursively extract body
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

    body = extractBody(payload) || decodeBase64(payload?.body?.data || '');

    res.json({ subject, from, date, body });

  } catch (err) {
    console.error('Fetch message error:', err);
    res.status(500).json({ error: 'Failed to load message' });
  }
});

module.exports = router;
