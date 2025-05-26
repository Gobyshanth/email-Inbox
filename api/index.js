const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

// Create OAuth2 client with tokens if available
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

// Root endpoint - simple link to start Google Auth flow
router.get('/', (req, res) => {
  res.send('<a href="/auth/google">Open Inbox</a>');
});

// Redirect to Google OAuth consent screen
router.get('/auth/google', (req, res) => {
  const oAuth2Client = createOAuth2Client();
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });
  res.redirect(authUrl);
});

// OAuth2 callback: exchange code for tokens, save in session, and list messages
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

    // Fetch message metadata (subject, from, date)
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

    // Send the messages data as JSON for frontend to render
    res.json({ messages: messageSummaries });

  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching Gmail inbox.');
  }
});

// Middleware to check if user is authenticated
function ensureAuthenticated(req, res, next) {
  if (!req.session.tokens) {
    return res.status(401).send('Not authenticated. Please <a href="/auth/google">login</a>.');
  }
  next();
}

// Get a single message's full content by ID
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

    if (payload.parts) {
      const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
      const plainPart = payload.parts.find(p => p.mimeType === 'text/plain');

      if (htmlPart?.body?.data) {
        body = decodeBase64(htmlPart.body.data);
      } else if (plainPart?.body?.data) {
        body = decodeBase64(plainPart.body.data);
      }
    } else if (payload.body?.data) {
      body = decodeBase64(payload.body.data);
    }

    res.json({ subject, from, date, body });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load message' });
  }
});

module.exports = router;
