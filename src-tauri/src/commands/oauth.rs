use tauri::{command, Manager, Emitter, AppHandle};
use std::env;
use std::thread;

const BC_REDIRECT_URI_DEV: &str = "http://localhost:3000/callback";
const BC_REDIRECT_URI_PROD: &str = "https://redd-todo.netlify.app/.netlify/functions/auth";

// Dev client ID uses localhost redirect
const BC_CLIENT_ID_DEV: &str = "aed7f4889aa6bb83b74e8e494e70701d59d1c9c5";

/// Get Basecamp client ID from environment (for prod) or use dev ID
fn get_client_id(is_dev: bool) -> String {
    if is_dev {
        return BC_CLIENT_ID_DEV.to_string();
    }
    
    // Try to load .env file (ignore if not found)
    let _ = dotenvy::dotenv();
    env::var("BASECAMP_CLIENT_ID").unwrap_or_else(|_| {
        log::warn!("BASECAMP_CLIENT_ID not found in environment");
        String::new()
    })
}

/// Start Basecamp OAuth flow
#[command]
pub async fn start_basecamp_auth(app: AppHandle) -> Result<(), String> {
    let is_dev = cfg!(debug_assertions);
    let client_id = get_client_id(is_dev);
    
    if client_id.is_empty() {
        let error_msg = "BASECAMP_CLIENT_ID not configured";
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("basecamp-auth-error", error_msg);
        }
        return Err(error_msg.to_string());
    }
    
    let redirect_uri = if is_dev {
        BC_REDIRECT_URI_DEV
    } else {
        BC_REDIRECT_URI_PROD
    };
    
    let auth_url = format!(
        "https://launchpad.37signals.com/authorization/new?type=web_server&client_id={}&redirect_uri={}",
        client_id,
        urlencoding::encode(redirect_uri)
    );
    
    log::info!("[Basecamp OAuth] Opening auth URL: {}", auth_url);
    log::info!("[Basecamp OAuth] isDev: {}, redirect_uri: {}", is_dev, redirect_uri);
    
    if is_dev {
        // Dev mode: start local HTTP server to receive callback
        let app_handle = app.clone();
        let client_id_clone = client_id.clone();
        
        thread::spawn(move || {
            start_local_callback_server(app_handle, client_id_clone);
        });
        
        // Small delay to ensure server is ready
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    
    // Open browser for OAuth
    if let Err(e) = open::that(&auth_url) {
        let error_msg = format!("Failed to open browser: {}", e);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("basecamp-auth-error", &error_msg);
        }
        return Err(error_msg);
    }
    
    Ok(())
}

/// Start local HTTP server to receive OAuth callback (dev mode only)
fn start_local_callback_server(app: AppHandle, client_id: String) {
    log::info!("[Basecamp OAuth] Starting local callback server on port 3000");
    
    let server = match tiny_http::Server::http("127.0.0.1:3000") {
        Ok(s) => s,
        Err(e) => {
            log::error!("[Basecamp OAuth] Failed to start server: {}", e);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("basecamp-auth-error", format!("Failed to start callback server: {}", e));
            }
            return;
        }
    };
    
    log::info!("[Basecamp OAuth] Local server listening on port 3000");
    
    // Wait for one request (the callback)
    if let Some(request) = server.recv().ok() {
        let url = request.url().to_string();
        log::info!("[Basecamp OAuth] Received request: {}", url);
        
        if url.starts_with("/callback") {
            // Parse the URL to get the code
            let full_url = format!("http://localhost:3000{}", url);
            if let Ok(parsed) = url::Url::parse(&full_url) {
                let code = parsed.query_pairs()
                    .find(|(k, _)| k == "code")
                    .map(|(_, v)| v.to_string());
                
                if let Some(code) = code {
                    log::info!("[Basecamp OAuth] Received code, exchanging for token...");
                    
                    // Exchange code for token via Netlify function
                    let rt = tokio::runtime::Runtime::new().unwrap();
                    match rt.block_on(exchange_code_for_token(&code, &client_id)) {
                        Ok(token_data) => {
                            log::info!("[Basecamp OAuth] Token exchange successful");
                            
                            // Send success response to browser
                            let response = tiny_http::Response::from_string(
                                "<html><body style=\"font-family: system-ui; text-align: center; padding-top: 50px;\">
                                <h1>Authentication successful!</h1>
                                <p>You can close this window and return to ReDD Do.</p>
                                <script>window.close()</script>
                                </body></html>"
                            ).with_header(
                                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap()
                            );
                            let _ = request.respond(response);
                            
                            // Emit success to frontend
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("basecamp-auth-success", token_data);
                                let _ = window.set_focus();
                            }
                        }
                        Err(e) => {
                            log::error!("[Basecamp OAuth] Token exchange failed: {}", e);
                            
                            let response = tiny_http::Response::from_string(
                                format!("Authentication failed: {}", e)
                            ).with_status_code(500);
                            let _ = request.respond(response);
                            
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.emit("basecamp-auth-error", e);
                            }
                        }
                    }
                } else {
                    log::error!("[Basecamp OAuth] No code in callback URL");
                    let response = tiny_http::Response::from_string("No authorization code received")
                        .with_status_code(400);
                    let _ = request.respond(response);
                }
            }
        } else {
            let response = tiny_http::Response::from_string("Not found").with_status_code(404);
            let _ = request.respond(response);
        }
    }
    
    log::info!("[Basecamp OAuth] Local server shutting down");
}

/// Exchange authorization code for tokens via Netlify function
async fn exchange_code_for_token(code: &str, client_id: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    
    let response = client
        .post("https://redd-todo.netlify.app/.netlify/functions/exchange")
        .json(&serde_json::json!({
            "code": code,
            "redirect_uri": BC_REDIRECT_URI_DEV,
            "client_id": client_id
        }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed: {}", error_text));
    }
    
    let mut token_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
    
    // Add client_id to response
    if let Some(obj) = token_data.as_object_mut() {
        obj.insert("client_id".to_string(), serde_json::json!(client_id));
    }
    
    Ok(token_data)
}

/// Handle OAuth callback (called from deep link handler in production)
#[command]
pub async fn handle_oauth_callback(app: AppHandle, url: String) -> Result<(), String> {
    log::info!("[Basecamp OAuth] Received callback URL: {}", url);
    
    let parsed = match url::Url::parse(&url) {
        Ok(u) => u,
        Err(e) => {
            let error_msg = format!("Failed to parse OAuth URL: {}", e);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("basecamp-auth-error", &error_msg);
            }
            return Err(error_msg);
        }
    };
    
    // Check for error in callback
    if let Some(error) = parsed.query_pairs().find(|(k, _)| k == "error") {
        let error_desc = parsed.query_pairs()
            .find(|(k, _)| k == "error_description")
            .map(|(_, v)| v.to_string())
            .unwrap_or_else(|| error.1.to_string());
        
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("basecamp-auth-error", &error_desc);
        }
        return Err(error_desc);
    }
    
    // Extract tokens
    let access_token = parsed.query_pairs()
        .find(|(k, _)| k == "access_token")
        .map(|(_, v)| v.to_string());
    
    let refresh_token = parsed.query_pairs()
        .find(|(k, _)| k == "refresh_token")
        .map(|(_, v)| v.to_string());
    
    let expires_in = parsed.query_pairs()
        .find(|(k, _)| k == "expires_in")
        .map(|(_, v)| v.to_string());
    
    let is_dev = cfg!(debug_assertions);
    
    match access_token {
        Some(token) => {
            let payload = serde_json::json!({
                "access_token": token,
                "refresh_token": refresh_token,
                "expires_in": expires_in,
                "client_id": get_client_id(is_dev)
            });
            
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("basecamp-auth-success", payload);
                let _ = window.set_focus();
            }
            
            Ok(())
        }
        None => {
            let error_msg = "No access token received";
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("basecamp-auth-error", error_msg);
            }
            Err(error_msg.to_string())
        }
    }
}
