const https = require('https');

exports.handler = async function(event, context) {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { code, redirect_uri } = JSON.parse(event.body);

    if (!code) {
        return { statusCode: 400, body: 'Missing authorization code' };
    }

    // Get secrets from Netlify Environment Variables
    const CLIENT_ID = process.env.BC_CLIENT_ID;
    const CLIENT_SECRET = process.env.BC_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
        return { statusCode: 500, body: 'Server misconfigured: Missing secrets' };
    }

    try {
        const tokenData = await exchangeCodeForToken(code, redirect_uri, CLIENT_ID, CLIENT_SECRET);
        
        // Success! Return the tokens to the Electron app
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(tokenData)
        };

    } catch (error) {
        console.error('Token exchange error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};

function exchangeCodeForToken(code, redirectUri, clientId, clientSecret) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            type: 'web_server',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code: code
        });

        const options = {
            hostname: 'launchpad.37signals.com',
            path: '/authorization/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData.length
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`Basecamp responded with status ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

