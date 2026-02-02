import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PORT = process.env.DASHBOARD_PORT || 3000;
const OUTPUT_DIR = path.join(__dirname, 'output_folder');
const TOKENS_FILE = path.join(__dirname, '.instagram-tokens.json');

// Facebook App credentials (needed for OAuth)
const FB_APP_ID = process.env.FB_APP_ID;
const FB_APP_SECRET = process.env.FB_APP_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL;

// Load saved Instagram tokens
let instagramTokens = null;
async function loadTokens() {
  try {
    if (await fs.pathExists(TOKENS_FILE)) {
      instagramTokens = JSON.parse(await fs.readFile(TOKENS_FILE, 'utf-8'));
      
      // Auto-refresh if token expires within 7 days
      if (instagramTokens && instagramTokens.expiresAt && instagramTokens.accessToken) {
        const expiresAt = new Date(instagramTokens.expiresAt);
        const daysUntilExpiry = (expiresAt - Date.now()) / (1000 * 60 * 60 * 24);
        
        if (daysUntilExpiry < 7 && daysUntilExpiry > 0) {
          console.log(`Token expires in ${Math.round(daysUntilExpiry)} days - auto-refreshing...`);
          await autoRefreshToken();
        } else if (daysUntilExpiry <= 0) {
          console.log('Token has expired. Please refresh manually.');
        }
      }
    }
  } catch (e) {
    console.error('Error loading tokens:', e.message);
    instagramTokens = null;
  }
}

// Auto-refresh long-lived token
async function autoRefreshToken() {
  try {
    if (!instagramTokens?.accessToken || !FB_APP_ID || !FB_APP_SECRET) {
      return;
    }
    
    // Refresh the long-lived token
    const refreshUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `grant_type=fb_exchange_token` +
      `&client_id=${FB_APP_ID}` +
      `&client_secret=${FB_APP_SECRET}` +
      `&fb_exchange_token=${instagramTokens.accessToken}`;
    
    const response = await fetch(refreshUrl);
    const data = await response.json();
    
    if (data.error) {
      console.error('Auto-refresh failed:', data.error.message);
      return;
    }
    
    // Update token with new expiry
    instagramTokens.accessToken = data.access_token;
    instagramTokens.expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    
    await saveTokens(instagramTokens);
    console.log('✓ Token auto-refreshed! New expiry:', instagramTokens.expiresAt);
  } catch (error) {
    console.error('Auto-refresh error:', error.message);
  }
}

loadTokens();

async function saveTokens(tokens) {
  instagramTokens = tokens;
  await fs.writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

// Get current Instagram credentials
function getInstagramCreds() {
  // First check saved tokens, then env vars
  if (instagramTokens && instagramTokens.accessToken) {
    return {
      accessToken: instagramTokens.accessToken,
      userId: instagramTokens.userId,
      username: instagramTokens.username
    };
  }
  return {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
    userId: process.env.INSTAGRAM_USER_ID,
    username: 'silkpath.co'
  };
}

/**
 * Exchange short-lived token for long-lived token and get Page Access Token
 */
async function refreshInstagramToken(shortLivedToken) {
  try {
    // Step 1: Exchange for long-lived user token (60 days)
    const longTokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `grant_type=fb_exchange_token` +
      `&client_id=${FB_APP_ID}` +
      `&client_secret=${FB_APP_SECRET}` +
      `&fb_exchange_token=${shortLivedToken}`;
    
    const longTokenResponse = await fetch(longTokenUrl);
    const longTokenData = await longTokenResponse.json();
    
    if (longTokenData.error) {
      throw new Error(longTokenData.error.message);
    }
    
    const longLivedUserToken = longTokenData.access_token;
    console.log('Got long-lived user token (60 days)');
    
    // Step 2: Get Page Access Token for SilkPath (page ID: 1022163574308658)
    const pageTokenUrl = `https://graph.facebook.com/v18.0/1022163574308658?fields=access_token,instagram_business_account{id,username}&access_token=${longLivedUserToken}`;
    
    const pageResponse = await fetch(pageTokenUrl);
    const pageData = await pageResponse.json();
    
    if (pageData.error) {
      throw new Error(pageData.error.message);
    }
    
    const pageAccessToken = pageData.access_token;
    const instagramAccount = pageData.instagram_business_account;
    
    console.log('Got Page Access Token for SilkPath');
    console.log('Instagram account:', instagramAccount?.username || instagramAccount?.id);
    
    // Save tokens
    const tokens = {
      accessToken: pageAccessToken,
      userId: instagramAccount?.id || '17841472995664251',
      username: instagramAccount?.username || 'silkpath.co',
      pageId: '1022163574308658',
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() // ~60 days
    };
    
    await saveTokens(tokens);
    
    return tokens;
  } catch (error) {
    console.error('Token refresh error:', error.message);
    throw error;
  }
}

// API endpoint to refresh token
app.post('/api/refresh-token', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }
  
  try {
    const tokens = await refreshInstagramToken(token);
    res.json({ success: true, username: tokens.username, expiresAt: tokens.expiresAt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve static files from output folder
app.use('/images', express.static(OUTPUT_DIR));

/**
 * Instagram OAuth - Step 1: Redirect to Facebook Login
 */
app.get('/auth/instagram', (req, res) => {
  if (!FB_APP_ID || !PUBLIC_URL) {
    return res.send(`
      <h2>Configuration Required</h2>
      <p>Add these to your .env file:</p>
      <pre>
FB_APP_ID=your_facebook_app_id
FB_APP_SECRET=your_facebook_app_secret
PUBLIC_URL=https://your-ngrok-url.ngrok.io
      </pre>
      <p><a href="/">Back to Dashboard</a></p>
    `);
  }
  
  const redirectUri = `${PUBLIC_URL}/auth/instagram/callback`;
  // In dev mode, app developers can use these permissions without App Review
  const scope = 'public_profile,pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish';
  
  const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${FB_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scope}` +
    `&response_type=code`;
  
  res.redirect(authUrl);
});

/**
 * Instagram OAuth - Step 2: Handle callback and exchange code for token
 */
app.get('/auth/instagram/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.send(`<h2>Authorization Error</h2><p>${error}</p><a href="/">Back</a>`);
  }
  
  if (!code) {
    return res.send(`<h2>No authorization code received</h2><a href="/">Back</a>`);
  }
  
  try {
    const redirectUri = `${PUBLIC_URL}/auth/instagram/callback`;
    
    // Exchange code for access token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `client_id=${FB_APP_ID}` +
      `&client_secret=${FB_APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code=${code}`;
    
    const tokenResponse = await fetch(tokenUrl);
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      throw new Error(tokenData.error.message);
    }
    
    const shortLivedToken = tokenData.access_token;
    
    // Exchange for long-lived token (60 days)
    const longTokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?` +
      `grant_type=fb_exchange_token` +
      `&client_id=${FB_APP_ID}` +
      `&client_secret=${FB_APP_SECRET}` +
      `&fb_exchange_token=${shortLivedToken}`;
    
    const longTokenResponse = await fetch(longTokenUrl);
    const longTokenData = await longTokenResponse.json();
    
    const accessToken = longTokenData.access_token || shortLivedToken;
    
    // Get Facebook Pages
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`
    );
    const pagesData = await pagesResponse.json();
    
    if (!pagesData.data || pagesData.data.length === 0) {
      throw new Error('No Facebook Pages found. You need a Facebook Page linked to your Instagram account.');
    }
    
    // Get Instagram account for each page
    let instagramAccount = null;
    for (const page of pagesData.data) {
      const igResponse = await fetch(
        `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`
      );
      const igData = await igResponse.json();
      
      if (igData.instagram_business_account) {
        // Get Instagram username
        const igInfoResponse = await fetch(
          `https://graph.facebook.com/v18.0/${igData.instagram_business_account.id}?fields=username&access_token=${accessToken}`
        );
        const igInfo = await igInfoResponse.json();
        
        instagramAccount = {
          id: igData.instagram_business_account.id,
          username: igInfo.username,
          pageId: page.id,
          pageName: page.name,
          pageAccessToken: page.access_token
        };
        break;
      }
    }
    
    if (!instagramAccount) {
      throw new Error('No Instagram Business/Creator account found linked to your Facebook Pages.');
    }
    
    // Save tokens
    await saveTokens({
      accessToken: instagramAccount.pageAccessToken, // Use page token for posting
      userId: instagramAccount.id,
      username: instagramAccount.username,
      pageId: instagramAccount.pageId,
      pageName: instagramAccount.pageName,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() // ~60 days
    });
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connected!</title>
        <style>
          body { font-family: sans-serif; background: #0a0a0a; color: #f5f0eb; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
          .card { background: #1a1a1a; padding: 3rem; border-radius: 12px; text-align: center; }
          h1 { color: #4a9c6d; }
          .username { color: #c9a87c; font-size: 1.5rem; }
          a { display: inline-block; margin-top: 2rem; background: #c9a87c; color: #0a0a0a; padding: 1rem 2rem; border-radius: 6px; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>✓ Instagram Connected!</h1>
          <p class="username">@${instagramAccount.username}</p>
          <p>You can now post directly to Instagram from the dashboard.</p>
          <a href="/">Go to Dashboard</a>
        </div>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('OAuth error:', error);
    res.send(`
      <h2>Error</h2>
      <p>${error.message}</p>
      <p><a href="/">Back to Dashboard</a></p>
    `);
  }
});

/**
 * Disconnect Instagram
 */
app.post('/auth/instagram/disconnect', async (req, res) => {
  try {
    if (await fs.pathExists(TOKENS_FILE)) {
      await fs.remove(TOKENS_FILE);
    }
    instagramTokens = null;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Post image to Instagram using Graph API
 */
async function postToInstagram(imageUrl, caption) {
  const creds = getInstagramCreds();
  
  if (!creds.accessToken || !creds.userId) {
    throw new Error('Instagram not connected. Click "Connect Instagram" to authenticate.');
  }
  
  console.log('Posting to Instagram:', imageUrl);
  
  // Step 1: Create media container
  const createMediaUrl = `https://graph.facebook.com/v18.0/${creds.userId}/media`;
  const createResponse = await fetch(createMediaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: caption,
      access_token: creds.accessToken
    })
  });
  
  const createData = await createResponse.json();
  console.log('Create container response:', createData);
  
  if (createData.error) {
    throw new Error(createData.error.message);
  }
  
  const creationId = createData.id;
  
  // Step 2: Wait for container to be ready (poll status)
  let status = 'IN_PROGRESS';
  let attempts = 0;
  const maxAttempts = 30; // Max 30 seconds
  
  while (status === 'IN_PROGRESS' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    const statusUrl = `https://graph.facebook.com/v18.0/${creationId}?fields=status_code,status&access_token=${creds.accessToken}`;
    const statusResponse = await fetch(statusUrl);
    const statusData = await statusResponse.json();
    
    console.log('Container status:', statusData);
    
    if (statusData.status_code) {
      status = statusData.status_code;
    } else if (statusData.status) {
      status = statusData.status;
    } else {
      // No status field means it's ready
      status = 'FINISHED';
    }
    
    attempts++;
  }
  
  if (status === 'ERROR') {
    throw new Error('Instagram failed to process the image');
  }
  
  if (status === 'IN_PROGRESS') {
    throw new Error('Instagram is taking too long to process the image');
  }
  
  // Step 3: Publish the media
  const publishUrl = `https://graph.facebook.com/v18.0/${creds.userId}/media_publish`;
  const publishResponse = await fetch(publishUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id: creationId,
      access_token: creds.accessToken
    })
  });
  
  const publishData = await publishResponse.json();
  console.log('Publish response:', publishData);
  
  if (publishData.error) {
    throw new Error(publishData.error.message);
  }
  
  return publishData;
}

/**
 * Update gallery.json with posted status
 */
async function markAsPosted(imageId) {
  const galleryPath = path.join(OUTPUT_DIR, 'gallery.json');
  const data = await fs.readFile(galleryPath, 'utf-8');
  const galleryData = JSON.parse(data);
  
  const image = galleryData.images.find(img => img.id === imageId);
  if (image) {
    image.postedToInstagram = true;
    image.postedAt = new Date().toISOString();
    await fs.writeFile(galleryPath, JSON.stringify(galleryData, null, 2));
  }
  
  return galleryData;
}

// API endpoint to post to Instagram
app.post('/api/post-to-instagram', async (req, res) => {
  try {
    const { imageId, filename, caption } = req.body;
    
    if (!PUBLIC_URL) {
      return res.status(400).json({ 
        error: 'PUBLIC_URL not configured. Instagram requires images to be publicly accessible. Set PUBLIC_URL in .env (e.g., use ngrok)' 
      });
    }
    
    const creds = getInstagramCreds();
    if (!creds.accessToken || !creds.userId) {
      return res.status(400).json({ 
        error: 'Instagram not connected. Click "Connect Instagram" to authenticate.' 
      });
    }
    
    const imageUrl = `${PUBLIC_URL}/images/${filename}`;
    
    console.log('Posting to Instagram:', imageUrl);
    
    const result = await postToInstagram(imageUrl, caption);
    
    // Mark as posted in gallery
    await markAsPosted(imageId);
    
    res.json({ success: true, instagramMediaId: result.id });
  } catch (error) {
    console.error('Instagram post error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to check Instagram configuration
app.get('/api/instagram-status', (req, res) => {
  const creds = getInstagramCreds();
  res.json({
    connected: !!(creds.accessToken && creds.userId),
    username: instagramTokens?.username || null,
    hasPublicUrl: !!PUBLIC_URL,
    publicUrl: PUBLIC_URL || null,
    expiresAt: instagramTokens?.expiresAt || null
  });
});

// Serve the dashboard HTML
app.get('/', async (req, res) => {
  try {
    const galleryPath = path.join(OUTPUT_DIR, 'gallery.json');
    let galleryData = { images: [] };
    
    if (await fs.pathExists(galleryPath)) {
      const data = await fs.readFile(galleryPath, 'utf-8');
      galleryData = JSON.parse(data);
    }
    
    // Sort by newest first
    galleryData.images.sort((a, b) => b.id - a.id);
    
    const creds = getInstagramCreds();
    const instagramConnected = !!(creds.accessToken && creds.userId);
    const canPost = instagramConnected && !!PUBLIC_URL;
    
    console.log('Instagram status:', { connected: instagramConnected, canPost, hasToken: !!creds.accessToken, hasUserId: !!creds.userId });
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hijab Style Gallery</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Montserrat:wght@300;400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0a0a;
      --bg-secondary: #141414;
      --bg-card: #1a1a1a;
      --text-primary: #f5f0eb;
      --text-secondary: #a89f94;
      --accent: #c9a87c;
      --accent-hover: #dbb98d;
      --border: #2a2a2a;
      --instagram: #E1306C;
      --instagram-hover: #f04d82;
      --success: #4a9c6d;
      --error: #c94a4a;
    }
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Montserrat', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.6;
    }
    
    header {
      background: linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%);
      padding: 3rem 2rem;
      text-align: center;
      border-bottom: 1px solid var(--border);
    }
    
    h1 {
      font-family: 'Cormorant Garamond', serif;
      font-size: 3rem;
      font-weight: 400;
      letter-spacing: 0.15em;
      color: var(--accent);
      margin-bottom: 0.5rem;
    }
    
    .subtitle { font-size: 0.85rem; letter-spacing: 0.3em; text-transform: uppercase; color: var(--text-secondary); }
    
    .ig-connect {
      margin-top: 1.5rem;
      display: inline-flex;
      align-items: center;
      gap: 1rem;
    }
    
    .ig-status {
      padding: 0.8rem 1.5rem;
      background: var(--bg-card);
      border-radius: 6px;
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .ig-status.connected { border: 1px solid var(--success); color: var(--success); }
    .ig-status.not-connected { border: 1px solid var(--error); color: var(--error); }
    
    .btn-connect {
      background: var(--instagram);
      color: white;
      border: none;
      padding: 0.8rem 1.5rem;
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
      font-family: 'Montserrat', sans-serif;
    }
    .btn-connect:hover { background: var(--instagram-hover); }
    
    .btn-disconnect {
      background: transparent;
      color: var(--text-secondary);
      border: 1px solid var(--border);
      padding: 0.6rem 1rem;
      font-size: 0.7rem;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn-disconnect:hover { border-color: var(--error); color: var(--error); }
    
    .stats {
      display: flex;
      justify-content: center;
      gap: 3rem;
      margin-top: 2rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border);
    }
    
    .stat { text-align: center; }
    .stat-value { font-family: 'Cormorant Garamond', serif; font-size: 2.5rem; color: var(--accent); }
    .stat-label { font-size: 0.7rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-secondary); }
    
    .gallery {
      max-width: 1400px;
      margin: 0 auto;
      padding: 3rem 2rem;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 2rem;
    }
    
    .card {
      background: var(--bg-card);
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .card:hover { transform: translateY(-4px); box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
    
    .card-image-wrapper { position: relative; }
    .card-image { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
    .card-overlay { position: absolute; top: 0.5rem; right: 0.5rem; display: flex; gap: 0.5rem; opacity: 0; transition: opacity 0.2s; }
    .card:hover .card-overlay { opacity: 1; }
    .btn-heart, .btn-delete { width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; transition: transform 0.2s; }
    .btn-heart { background: rgba(255,255,255,0.9); }
    .btn-heart:hover { transform: scale(1.1); }
    .btn-heart.active { background: rgba(255,200,200,0.95); }
    .btn-delete { background: rgba(255,255,255,0.9); }
    .btn-delete:hover { transform: scale(1.1); background: rgba(255,200,200,0.95); }
    .fav-badge { background: transparent; color: #ff4444; }
    .card-content { padding: 1.5rem; }
    .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .hijab-style { font-family: 'Cormorant Garamond', serif; font-size: 1.4rem; color: var(--accent); text-transform: capitalize; }
    
    .badges { display: flex; gap: 0.5rem; }
    .provider-badge, .posted-badge {
      font-size: 0.65rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
    }
    .provider-badge { background: var(--border); color: var(--text-secondary); }
    .posted-badge { background: var(--success); color: white; }
    
    .caption { font-size: 0.9rem; color: var(--text-secondary); line-height: 1.7; margin-bottom: 1rem; }
    
    .card-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    
    .btn {
      border: none;
      padding: 0.6rem 1.2rem;
      font-size: 0.75rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: 'Montserrat', sans-serif;
    }
    
    .btn-copy { background: var(--accent); color: var(--bg-primary); }
    .btn-copy:hover { background: var(--accent-hover); }
    .btn-copy.copied { background: var(--success); }
    
    .btn-download { background: var(--border); color: var(--text-primary); text-decoration: none; }
    .btn-download:hover { background: #3a3a3a; }
    
    .btn-refresh { background: var(--bg-card); color: var(--accent); border: 1px solid var(--accent); padding: 0.5rem 1rem; font-size: 0.7rem; border-radius: 4px; cursor: pointer; font-family: 'Montserrat', sans-serif; }
    .btn-refresh:hover { background: var(--accent); color: var(--bg-primary); }
    
    .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; justify-content: center; align-items: center; }
    .modal.show { display: flex; }
    .modal-content { background: var(--bg-card); padding: 2rem; border-radius: 12px; max-width: 600px; width: 90%; }
    .modal-content h3 { color: var(--accent); margin-bottom: 1rem; font-family: 'Cormorant Garamond', serif; }
    .modal-content p { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1rem; }
    .modal-content input { width: 100%; padding: 0.8rem; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary); font-size: 0.85rem; margin-bottom: 1rem; }
    .modal-content .btn-row { display: flex; gap: 1rem; justify-content: flex-end; }
    .modal-content .btn-cancel { background: var(--border); color: var(--text-primary); }
    .modal-content .btn-submit { background: var(--accent); color: var(--bg-primary); }
    
    .btn-instagram { background: var(--instagram); color: white; }
    .btn-instagram:hover { background: var(--instagram-hover); }
    .btn-instagram.posting { opacity: 0.7; cursor: wait; }
    .btn-instagram.posted { background: var(--success); }
    
    .date { font-size: 0.7rem; color: var(--text-secondary); margin-top: 1rem; opacity: 0.6; }
    
    .empty-state { text-align: center; padding: 6rem 2rem; color: var(--text-secondary); }
    .empty-state h2 { font-family: 'Cormorant Garamond', serif; font-size: 2rem; color: var(--text-primary); margin-bottom: 1rem; }
    
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      padding: 1rem 1.5rem;
      border-radius: 6px;
      font-size: 0.85rem;
      z-index: 1000;
      animation: slideIn 0.3s ease;
    }
    .toast.success { background: var(--success); color: white; }
    .toast.error { background: var(--error); color: white; }
    
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    
    .setup-info {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 2rem;
      margin: 2rem auto;
      max-width: 800px;
    }
    
    .setup-info h3 { color: var(--accent); margin-bottom: 1rem; font-family: 'Cormorant Garamond', serif; }
    .setup-info ol { padding-left: 1.5rem; color: var(--text-secondary); }
    .setup-info li { margin-bottom: 0.5rem; }
    .setup-info code { background: var(--bg-primary); padding: 0.2rem 0.5rem; border-radius: 3px; font-size: 0.85rem; }
    
    @media (max-width: 768px) {
      h1 { font-size: 2rem; }
      .gallery { grid-template-columns: 1fr; padding: 1.5rem; }
      .stats { flex-direction: column; gap: 1.5rem; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Hijab Style Gallery</h1>
    <p class="subtitle">AI-Generated Fashion Collection</p>
    
    ${creds.accessToken && creds.userId ? `
      <div class="ig-status connected" style="margin-top: 1rem;">
        ✓ Connected as @${creds.username || 'instagram'}
        ${instagramTokens?.expiresAt ? ` <span style="opacity: 0.6; font-size: 0.7rem;">(expires ${new Date(instagramTokens.expiresAt).toLocaleDateString()})</span>` : ''}
      </div>
      <button class="btn-refresh" onclick="showRefreshModal()" style="margin-top: 0.5rem;">
        🔄 Refresh Token
      </button>
    ` : `
      <p style="margin-top: 1rem; color: var(--error); font-size: 0.85rem;">
        ⚠ Token expired or not set
      </p>
      <button class="btn-refresh" onclick="showRefreshModal()" style="margin-top: 0.5rem;">
        🔑 Set Access Token
      </button>
    `}
    
    <div class="stats">
      <div class="stat">
        <div class="stat-value">${galleryData.images.length}</div>
        <div class="stat-label">Total Images</div>
      </div>
      <div class="stat">
        <div class="stat-value">${new Set(galleryData.images.map(i => i.hijabStyle)).size}</div>
        <div class="stat-label">Hijab Styles</div>
      </div>
      <div class="stat">
        <div class="stat-value">${galleryData.images.filter(i => i.postedToInstagram).length}</div>
        <div class="stat-label">Posted to IG</div>
      </div>
      <div class="stat">
        <div class="stat-value">${galleryData.images.filter(i => i.favorited).length}</div>
        <div class="stat-label">Favorites</div>
      </div>
    </div>
  </header>
  
  ${!instagramConnected && (!FB_APP_ID || !FB_APP_SECRET) ? `
  <div class="setup-info">
    <h3>Instagram Setup</h3>
    <ol>
      <li>Create a Facebook Developer App at <a href="https://developers.facebook.com" target="_blank" style="color: var(--accent);">developers.facebook.com</a></li>
      <li>Add "Facebook Login" and "Instagram Graph API" products</li>
      <li>In Facebook Login settings, add <code>${PUBLIC_URL || 'YOUR_PUBLIC_URL'}/auth/instagram/callback</code> to Valid OAuth Redirect URIs</li>
      <li>Run ngrok: <code>ngrok http 3000</code></li>
      <li>Add to your <code>.env</code>:
        <br><code>FB_APP_ID=your_app_id</code>
        <br><code>FB_APP_SECRET=your_app_secret</code>
        <br><code>PUBLIC_URL=https://your-ngrok-url.ngrok.io</code>
      </li>
      <li>Restart the dashboard and click "Connect Instagram"</li>
    </ol>
  </div>
  ` : ''}
  
  <main class="gallery">
    ${galleryData.images.length === 0 ? `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h2>No Images Yet</h2>
        <p>Run the image generation script to create your first hijab style photos.</p>
        <p style="margin-top: 1rem;"><code>IMAGE_PROVIDER=gemini npm start</code></p>
      </div>
    ` : galleryData.images.map(img => `
      <div class="card" data-id="${img.id}">
        <div class="card-image-wrapper">
          <img class="card-image" src="/images/${img.filename}" alt="${img.hijabStyle} hijab style" loading="lazy">
          <div class="card-overlay">
            <button class="btn-heart ${img.favorited ? 'active' : ''}" onclick="toggleFavorite(this, ${img.id})">
              ${img.favorited ? '❤️' : '🤍'}
            </button>
            <button class="btn-delete" onclick="deleteImage(this, ${img.id})">
              🗑️
            </button>
          </div>
        </div>
        <div class="card-content">
          <div class="card-header">
            <span class="hijab-style">${img.hijabStyle.replace(/_/g, ' ')}</span>
            <div class="badges">
              ${img.favorited ? '<span class="fav-badge">❤️</span>' : ''}
              <span class="provider-badge">${img.provider || 'openai'}</span>
              ${img.postedToInstagram ? '<span class="posted-badge">Posted</span>' : ''}
            </div>
          </div>
          <p class="caption">${escapeHtml(img.caption)}</p>
          <div class="card-actions">
            <button class="btn btn-copy" onclick="copyCaption(this, \`${escapeForJs(img.caption)}\`)">
              Copy Caption
            </button>
            <a class="btn btn-download" href="/images/${img.filename}" download="${img.filename}">
              ↓ Download
            </a>
            <button class="btn btn-instagram" onclick="postToInstagram(this, ${img.id}, '${img.filename}', \`${escapeForJs(img.caption)}\`)">
              Post to IG
            </button>
          </div>
          <p class="date">${new Date(img.createdAt).toLocaleString()}</p>
        </div>
      </div>
    `).join('')}
  </main>
  
  <!-- Token Refresh Modal -->
  <div id="refreshModal" class="modal">
    <div class="modal-content">
      <h3>🔑 Refresh Instagram Token</h3>
      <p>1. Go to <a href="https://developers.facebook.com/tools/explorer" target="_blank" style="color: var(--accent);">Graph API Explorer</a></p>
      <p>2. Select "Auto Posting" app, then "User or Page" → "SilkPath"</p>
      <p>3. Copy the Access Token and paste below:</p>
      <input type="text" id="newToken" placeholder="Paste your access token here...">
      <div class="btn-row">
        <button class="btn btn-cancel" onclick="hideRefreshModal()">Cancel</button>
        <button class="btn btn-submit" onclick="submitToken()">Save Token</button>
      </div>
    </div>
  </div>

  <script>
    function showRefreshModal() {
      document.getElementById('refreshModal').classList.add('show');
    }
    
    function hideRefreshModal() {
      document.getElementById('refreshModal').classList.remove('show');
      document.getElementById('newToken').value = '';
    }
    
    async function submitToken() {
      const token = document.getElementById('newToken').value.trim();
      if (!token) {
        showToast('Please paste a token', 'error');
        return;
      }
      
      try {
        const response = await fetch('/api/refresh-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });
        
        const data = await response.json();
        
        if (data.error) {
          throw new Error(data.error);
        }
        
        showToast('Token refreshed! Connected as @' + data.username, 'success');
        hideRefreshModal();
        setTimeout(() => location.reload(), 1500);
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      }
    }
    
    async function toggleFavorite(btn, imageId) {
      try {
        const response = await fetch('/api/favorite/' + imageId, { method: 'POST' });
        const data = await response.json();
        
        if (data.error) throw new Error(data.error);
        
        btn.innerHTML = data.favorited ? '❤️' : '🤍';
        btn.classList.toggle('active', data.favorited);
        
        // Update badge
        const card = btn.closest('.card');
        const badges = card.querySelector('.badges');
        const favBadge = badges.querySelector('.fav-badge');
        
        if (data.favorited && !favBadge) {
          badges.insertAdjacentHTML('afterbegin', '<span class="fav-badge">❤️</span>');
        } else if (!data.favorited && favBadge) {
          favBadge.remove();
        }
        
        showToast(data.favorited ? 'Added to favorites!' : 'Removed from favorites');
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      }
    }
    
    async function deleteImage(btn, imageId) {
      if (!confirm('Delete this image? This cannot be undone.')) return;
      
      try {
        const response = await fetch('/api/image/' + imageId, { method: 'DELETE' });
        const data = await response.json();
        
        if (data.error) throw new Error(data.error);
        
        const card = btn.closest('.card');
        card.style.transform = 'scale(0)';
        card.style.opacity = '0';
        setTimeout(() => card.remove(), 300);
        
        showToast('Image deleted');
      } catch (error) {
        showToast('Error: ' + error.message, 'error');
      }
    }
    
    function showToast(message, type = 'success') {
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }
    
    function copyCaption(btn, caption) {
      navigator.clipboard.writeText(caption).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy Caption';
          btn.classList.remove('copied');
        }, 2000);
      });
    }
    
    async function postToInstagram(btn, imageId, filename, caption) {
      if (btn.disabled) return;
      
      btn.disabled = true;
      btn.textContent = 'Posting...';
      btn.classList.add('posting');
      
      try {
        const response = await fetch('/api/post-to-instagram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId, filename, caption })
        });
        
        const data = await response.json();
        
        if (data.error) {
          throw new Error(data.error);
        }
        
        btn.textContent = 'Posted ✓';
        btn.classList.remove('posting');
        btn.classList.add('posted');
        showToast('Successfully posted to Instagram!', 'success');
        
        const card = btn.closest('.card');
        const badges = card.querySelector('.badges');
        if (!badges.querySelector('.posted-badge')) {
          badges.innerHTML += '<span class="posted-badge">Posted</span>';
        }
      } catch (error) {
        btn.disabled = false;
        btn.textContent = 'Post to Instagram';
        btn.classList.remove('posting');
        showToast('Error: ' + error.message, 'error');
      }
    }
    
    async function disconnectInstagram() {
      if (!confirm('Disconnect Instagram account?')) return;
      
      try {
        await fetch('/auth/instagram/disconnect', { method: 'POST' });
        location.reload();
      } catch (error) {
        showToast('Error disconnecting', 'error');
      }
    }
  </script>
</body>
</html>
    `;
    
    res.send(html);
  } catch (error) {
    res.status(500).send('Error loading gallery: ' + error.message);
  }
});

// Helper functions for escaping
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeForJs(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

// API endpoint to toggle favorite
app.post('/api/favorite/:id', async (req, res) => {
  try {
    const imageId = parseInt(req.params.id);
    const galleryPath = path.join(OUTPUT_DIR, 'gallery.json');
    const data = await fs.readFile(galleryPath, 'utf-8');
    const galleryData = JSON.parse(data);
    
    const image = galleryData.images.find(img => img.id === imageId);
    if (image) {
      image.favorited = !image.favorited;
      await fs.writeFile(galleryPath, JSON.stringify(galleryData, null, 2));
      res.json({ success: true, favorited: image.favorited });
    } else {
      res.status(404).json({ error: 'Image not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to delete image
app.delete('/api/image/:id', async (req, res) => {
  try {
    const imageId = parseInt(req.params.id);
    const galleryPath = path.join(OUTPUT_DIR, 'gallery.json');
    const data = await fs.readFile(galleryPath, 'utf-8');
    const galleryData = JSON.parse(data);
    
    const imageIndex = galleryData.images.findIndex(img => img.id === imageId);
    if (imageIndex === -1) {
      return res.status(404).json({ error: 'Image not found' });
    }
    
    const image = galleryData.images[imageIndex];
    
    // Delete the actual file
    const imagePath = path.join(OUTPUT_DIR, image.filename);
    if (await fs.pathExists(imagePath)) {
      await fs.remove(imagePath);
    }
    
    // Remove from gallery
    galleryData.images.splice(imageIndex, 1);
    await fs.writeFile(galleryPath, JSON.stringify(galleryData, null, 2));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to get gallery data as JSON
app.get('/api/gallery', async (req, res) => {
  try {
    const galleryPath = path.join(OUTPUT_DIR, 'gallery.json');
    if (await fs.pathExists(galleryPath)) {
      const data = await fs.readFile(galleryPath, 'utf-8');
      res.json(JSON.parse(data));
    } else {
      res.json({ images: [] });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log('Dashboard running at http://localhost:' + PORT);
  console.log('');
  console.log('Instagram OAuth Status:');
  console.log('  FB App ID: ' + (FB_APP_ID ? '✓ Set' : '✗ Not set'));
  console.log('  FB App Secret: ' + (FB_APP_SECRET ? '✓ Set' : '✗ Not set'));
  console.log('  Public URL: ' + (PUBLIC_URL ? '✓ ' + PUBLIC_URL : '✗ Not set'));
  
  if (instagramTokens) {
    console.log('  Instagram: ✓ Connected as @' + instagramTokens.username);
  } else {
    console.log('  Instagram: ✗ Not connected');
  }
  
  console.log('');
  if (!FB_APP_ID || !FB_APP_SECRET || !PUBLIC_URL) {
    console.log('To enable Instagram OAuth, add to .env:');
    console.log('  FB_APP_ID=your_facebook_app_id');
    console.log('  FB_APP_SECRET=your_facebook_app_secret');
    console.log('  PUBLIC_URL=https://your-ngrok-url.ngrok.io');
  }
});
