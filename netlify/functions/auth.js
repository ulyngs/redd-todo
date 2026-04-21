const https = require('https');

// These will be set in your Netlify Site Settings
const CLIENT_ID = process.env.BC_CLIENT_ID;
const CLIENT_SECRET = process.env.BC_CLIENT_SECRET;
const REDIRECT_URI = 'https://redd-todo.netlify.app/.netlify/functions/auth';
const LOCAL_CALLBACK_STATE_PREFIX = 'localhost:';

exports.handler = async function (event, context) {
    // 1. HANDLE TOKEN REFRESH (POST)
    if (event.httpMethod === 'POST') {
        try {
            const { refresh_token } = JSON.parse(event.body);

            if (!refresh_token) {
                return { statusCode: 400, body: JSON.stringify({ error: 'Missing refresh_token' }) };
            }

            const tokenData = await exchangeToken({
                type: 'refresh',
                refresh_token: refresh_token,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET
            });

            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*' // Allow desktop app to call this
                },
                body: JSON.stringify(tokenData)
            };

        } catch (error) {
            return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
        }
    }

    // 2. HANDLE OAUTH CALLBACK (GET)
    if (event.httpMethod === 'GET') {
        const code = event.queryStringParameters.code;
        const state = event.queryStringParameters.state || '';

        if (!code) {
            return { statusCode: 400, body: 'Missing code parameter' };
        }

        try {
            const tokenData = await exchangeToken({
                type: 'web_server',
                code: code,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI
            });

            // Redirect to custom URL scheme that the Electron app handles
            // This works in sandboxed environments (Mac App Store, Windows Store)
            const params = new URLSearchParams({
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_in: tokenData.expires_in
            });

            const localhostPort = getLocalCallbackPort(state);
            if (localhostPort) {
                const localhostUrl = `http://127.0.0.1:${localhostPort}/callback?${params.toString()}`;
                const fallbackUrl = `redddo://oauth-callback?${params.toString()}`;
                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'no-store'
                    },
                    body: buildLocalBridgePage({
                        localhostUrl,
                        fallbackUrl,
                        success: true,
                        message: 'Sending Basecamp authentication back to ReDD Do...'
                    })
                };
            }

            return {
                statusCode: 302,
                headers: {
                    Location: `redddo://oauth-callback?${params.toString()}`
                }
            };

        } catch (error) {
            console.error('OAuth callback error:', error);
            // Redirect to app with error so user gets feedback
            const errorParams = new URLSearchParams({
                error: 'auth_failed',
                error_description: error.message
            });

            const localhostPort = getLocalCallbackPort(state);
            if (localhostPort) {
                const localhostUrl = `http://127.0.0.1:${localhostPort}/callback?${errorParams.toString()}`;
                const fallbackUrl = `redddo://oauth-callback?${errorParams.toString()}`;
                return {
                    statusCode: 200,
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'no-store'
                    },
                    body: buildLocalBridgePage({
                        localhostUrl,
                        fallbackUrl,
                        success: false,
                        message: 'Basecamp returned an authentication error.'
                    })
                };
            }

            return {
                statusCode: 302,
                headers: {
                    Location: `redddo://oauth-callback?${errorParams.toString()}`
                }
            };
        }
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
};

function exchangeToken(payload) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(payload);

        const options = {
            hostname: 'launchpad.37signals.com',
            path: '/authorization/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData.length,
                'User-Agent': 'ReDD-Todo-Auth-Service'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(data));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

function getLocalCallbackPort(state) {
    if (!state || !state.startsWith(LOCAL_CALLBACK_STATE_PREFIX)) {
        return null;
    }

    const port = Number.parseInt(state.slice(LOCAL_CALLBACK_STATE_PREFIX.length), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
    }

    return port;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildLocalBridgePage({ localhostUrl, fallbackUrl, success, message }) {
    const safeLocalhostUrl = JSON.stringify(localhostUrl);
    const safeFallbackUrl = JSON.stringify(fallbackUrl);
    const title = success ? 'Connecting ReDD Do' : 'Authentication Issue';
    const buttonLabel = success ? 'Open ReDD Do' : 'Try opening ReDD Do';

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f2ec;
        color: #1f2f38;
      }
      main {
        max-width: 36rem;
        margin: 10vh auto;
        background: rgba(255, 255, 255, 0.92);
        border-radius: 20px;
        padding: 2rem;
        box-shadow: 0 18px 50px rgba(17, 36, 48, 0.12);
        text-align: center;
      }
      h1 {
        margin-top: 0;
        font-size: 2rem;
      }
      p {
        line-height: 1.5;
      }
      a {
        display: inline-block;
        margin-top: 1rem;
        padding: 0.9rem 1.2rem;
        border-radius: 12px;
        background: #1f7a58;
        color: white;
        text-decoration: none;
        font-weight: 600;
      }
      .hint {
        margin-top: 1rem;
        font-size: 0.95rem;
        color: #5d6d75;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p id="status">${escapeHtml(message)}</p>
      <a id="fallback-link" href="${escapeHtml(fallbackUrl)}">${escapeHtml(buttonLabel)}</a>
      <p class="hint">If ReDD Do does not come back into focus automatically, use the button above.</p>
    </main>
    <script>
      const localhostUrl = ${safeLocalhostUrl};
      const fallbackUrl = ${safeFallbackUrl};
      const statusEl = document.getElementById('status');

      async function handoff() {
        try {
          await fetch(localhostUrl, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
          statusEl.textContent = 'ReDD Do received the callback. You can close this tab.';
          setTimeout(() => window.close(), 800);
          return;
        } catch (error) {
          console.error('Localhost callback failed', error);
        }

        statusEl.textContent = 'Could not reach the local app directly. Trying the fallback link...';
        window.location.href = fallbackUrl;
      }

      handoff();
    </script>
  </body>
</html>`;
}
