const https = require('https');

// These will be set in your Netlify Site Settings
const CLIENT_ID = process.env.BC_CLIENT_ID;
const CLIENT_SECRET = process.env.BC_CLIENT_SECRET;
const REDIRECT_URI = process.env.BC_REDIRECT_URI; // Your Netlify URL + /.netlify/functions/auth/callback

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

