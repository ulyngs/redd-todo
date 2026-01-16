const https = require('https');

// Client IDs for different environments
const PROD_CLIENT_ID = 'd83392d7842f055157c3fef1f5464b2e15a013dc';
const DEV_CLIENT_ID = 'aed7f4889aa6bb83b74e8e494e70701d59d1c9c5';

exports.handler = async function (event, context) {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { code, redirect_uri, client_id } = JSON.parse(event.body);

    if (!code) {
        return { statusCode: 400, body: 'Missing authorization code' };
    }

    // Select the appropriate client secret based on which app is calling
    let CLIENT_SECRET;
    if (client_id === DEV_CLIENT_ID) {
        CLIENT_SECRET = process.env.BC_DEV_CLIENT_SECRET;
        console.log('Using DEV client credentials');
    } else {
        CLIENT_SECRET = process.env.BC_CLIENT_SECRET;
        console.log('Using PROD client credentials');
    }

    if (!CLIENT_SECRET) {
        return { statusCode: 500, body: 'Server misconfigured: Missing client secret for this app' };
    }

    try {
        const tokenData = await exchangeCodeForToken(code, redirect_uri, client_id || PROD_CLIENT_ID, CLIENT_SECRET);

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

