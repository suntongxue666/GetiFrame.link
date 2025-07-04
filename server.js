const express = require('express');
const axios = require('axios');
const axiosRetry = require('axios-retry');
const cheerio = require('cheerio');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// Configure axios retry
axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || 
               (error.response && error.response.status >= 500);
    }
});

// Custom axios instance with enhanced configuration
const customAxios = axios.create({
    timeout: 30000, // 30 seconds
    maxRedirects: 5,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    }
});

// Apply retry configuration to custom instance
axiosRetry(customAxios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) || 
               (error.response && error.response.status >= 500);
    }
});

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Request logging middleware with unique ID
app.use((req, res, next) => {
    req.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    console.log(`[${req.id}] ${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Error handling middleware with detailed logging
app.use((err, req, res, next) => {
    const errorDetails = {
        message: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString(),
        url: req.url,
        method: req.method,
        headers: req.headers,
        query: req.query
    };
    
    console.error('Error details:', errorDetails);
    
    // Send appropriate error response
    const statusCode = err.response?.status || err.status || 500;
    const errorMessage = err.message || 'Internal server error';
    
    res.status(statusCode).json({
        error: errorMessage,
        requestId: req.id // Add request ID for tracking
    });
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// Helper function to get game slug from URL
function getGameSlug(url) {
    const match = url.match(/\/game\/([^\/\?#]+)/);
    return match ? match[1] : null;
}

// Helper function to implement delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to extract embed URL from game page
async function getGameEmbedUrl(gameSlug) {
    try {
        const gamePageUrl = `https://www.crazygames.com/game/${gameSlug}`;
        console.log('Fetching game page:', gamePageUrl);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://www.crazygames.com/'
        };
        
        const response = await axios.get(gamePageUrl, { 
            headers,
            timeout: 10000
        });
        
        const html = response.data;
        console.log('Successfully fetched game page');
        
        // Try to find the game data in various formats
        const gameDataPatterns = [
            /window\.__GAME__\s*=\s*({[^;]+});/,
            /window\.__INITIAL_STATE__\s*=\s*({[^;]+});/,
            /window\.__PRELOADED_STATE__\s*=\s*({[^;]+});/,
            /"game":\s*({[^}]+})/
        ];

        for (const pattern of gameDataPatterns) {
            const match = html.match(pattern);
            if (match) {
                try {
                    console.log('Found potential game data match with pattern:', pattern);
                    let gameData = JSON.parse(match[1]);
                    
                    // If the data is nested in a 'game' property, extract it
                    if (gameData.game) {
                        gameData = gameData.game;
                    }
                    
                    console.log('Parsed game data:', JSON.stringify(gameData, null, 2));
                    
                    // Check various possible URL fields
                    const urlFields = ['embedUrl', 'url', 'gameUrl', 'gamePath', 'files.game', 'game.url', 'playUrl'];
                    for (const field of urlFields) {
                        const value = field.split('.').reduce((obj, key) => obj && obj[key], gameData);
                        if (value && typeof value === 'string') {
                            console.log(`Found URL in field "${field}":`, value);
                            const fullUrl = value.startsWith('http') ? value : `https://www.crazygames.com${value}`;
                            return {
                                url: fullUrl,
                                title: gameData.title || gameData.name,
                                width: '100%',
                                height: '600'
                            };
                        }
                    }
                } catch (e) {
                    console.error('Error parsing game data:', e);
                }
            }
        }
        
        // Try to find any game-related URLs in script tags
        const $ = cheerio.load(html);
        
        // Look for meta tags that might contain the game URL
        const metaTags = $('meta[property="og:url"], meta[property="og:video"], meta[property="og:video:url"], meta[name="twitter:player"]');
        if (metaTags.length > 0) {
            console.log('Found meta tags:', metaTags.length);
            for (let i = 0; i < metaTags.length; i++) {
                const content = $(metaTags[i]).attr('content');
                if (content) {
                    console.log('Found URL in meta tag:', content);
                    const fullUrl = content.startsWith('http') ? content : `https://www.crazygames.com${content}`;
                    return {
                        url: fullUrl,
                        title: $('title').text().replace(' - Play Free Online Games', '').trim(),
                        width: '100%',
                        height: '600'
                    };
                }
            }
        }

        // Look for game container elements
        const gameContainers = $('#game-container, #gameContainer, .game-container, [data-game-url]');
        if (gameContainers.length > 0) {
            console.log('Found game containers:', gameContainers.length);
            const container = gameContainers.first();
            const gameUrl = container.attr('data-game-url') || container.attr('data-url') || container.attr('src');
            if (gameUrl) {
                console.log('Found URL in game container:', gameUrl);
                const fullUrl = gameUrl.startsWith('http') ? gameUrl : `https://www.crazygames.com${gameUrl}`;
                return {
                    url: fullUrl,
                    title: $('title').text().replace(' - Play Free Online Games', '').trim(),
                    width: '100%',
                    height: '600'
                };
            }
        }

        // Look for script tags with game URLs
        const scripts = $('script').map((i, el) => $(el).html()).get();
        const urlPatterns = [
            /"embedUrl"\s*:\s*"([^"]+)"/,
            /"gameUrl"\s*:\s*"([^"]+)"/,
            /"gamePath"\s*:\s*"([^"]+)"/,
            /"game_url"\s*:\s*"([^"]+)"/,
            /"playUrl"\s*:\s*"([^"]+)"/,
            /"files"\s*:\s*{\s*"game"\s*:\s*"([^"]+)"/,
            /iframe[^>]+src="([^"]+)"/,
            /src="([^"]+(?:game|play|embed)[^"]+)"/
        ];
        
        for (const script of scripts) {
            for (const pattern of urlPatterns) {
                const match = script.match(pattern);
                if (match && match[1]) {
                    console.log('Found URL in script with pattern:', pattern, 'URL:', match[1]);
                    const fullUrl = match[1].startsWith('http') ? match[1] : `https://www.crazygames.com${match[1]}`;
                    return {
                        url: fullUrl,
                        title: $('title').text().replace(' - Play Free Online Games', '').trim(),
                        width: '100%',
                        height: '600'
                    };
                }
            }
        }
        
        // Try to find any iframe that might contain the game
        const iframes = $('iframe');
        if (iframes.length > 0) {
            console.log('Found iframes:', iframes.length);
            for (let i = 0; i < iframes.length; i++) {
                const iframe = $(iframes[i]);
                const src = iframe.attr('src');
                if (src) {
                    console.log('Found URL in iframe:', src);
                    const fullUrl = src.startsWith('http') ? src : `https://www.crazygames.com${src}`;
                    return {
                        url: fullUrl,
                        title: $('title').text().replace(' - Play Free Online Games', '').trim(),
                        width: '100%',
                        height: '600'
                    };
                }
            }
        }

        // If all else fails, try to find any URL that looks like a game URL
        const allLinks = $('a[href*="/game/"], a[href*="/embed/"], a[href*="/play/"]');
        if (allLinks.length > 0) {
            console.log('Found potential game links:', allLinks.length);
            const gameLink = allLinks.first().attr('href');
            if (gameLink) {
                console.log('Using game link as fallback:', gameLink);
                const fullUrl = gameLink.startsWith('http') ? gameLink : `https://www.crazygames.com${gameLink}`;
                return {
                    url: fullUrl,
                    title: $('title').text().replace(' - Play Free Online Games', '').trim(),
                    width: '100%',
                    height: '600'
                };
            }
        }
        
        console.log('No game URL found in page');
        return null;
    } catch (error) {
        console.error('Error fetching game page:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            headers: error.response?.headers
        });
        return null;
    }
}

// Helper function to extract game links from category page
async function getGameLinksFromCategoryPage(url) {
    try {
        console.log('Fetching page:', url);
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://www.crazygames.com/',
            // 添加 CloudFlare 相关的头
            'CF-IPCountry': 'US',
            'CF-RAY': '',
            'CF-Visitor': '{"scheme":"https"}',
            'CDN-Loop': 'cloudflare'
        };

        const response = await axios.get(url, {
            headers,
            timeout: 30000,
            maxRedirects: 5,
            // 添加错误处理
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            },
            // 处理 CloudFlare 的响应
            responseType: 'text',
            transformResponse: [data => {
                try {
                    return JSON.parse(data);
                } catch (e) {
                    // 如果不是 JSON，返回原始数据
                    return data;
                }
            }]
        });

        // 检查响应类型
        if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE')) {
            console.log('Received HTML response instead of JSON');
            // 处理 HTML 响应...
        }

        // 其余代码保持不变...
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);
        }
        throw error;
    }
}

// Helper function to process game links in batches
async function processGameLinksInBatches(gameLinks, batchSize = 3) {
    const results = [];
    const batches = [];
    
    // Split links into batches
    for (let i = 0; i < gameLinks.length; i += batchSize) {
        batches.push(gameLinks.slice(i, i + batchSize));
    }
    
    console.log(`Processing ${gameLinks.length} games in ${batches.length} batches`);
    
    // Process each batch
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`Processing batch ${i + 1}/${batches.length}`);
        
        // Process games in current batch sequentially to avoid rate limiting
        for (const url of batch) {
            try {
                const gameSlug = getGameSlug(url);
                if (!gameSlug) continue;
                
                const gameData = await getGameEmbedUrl(gameSlug);
                if (!gameData) continue;
                
                const iframeCode = `<iframe 
                    src="${gameData.url}" 
                    width="${gameData.width}" 
                    height="${gameData.height}" 
                    scrolling="no" 
                    frameborder="0"
                    allow="autoplay; fullscreen; focus-without-user-activation *;"
                    allowfullscreen>
                </iframe>`.replace(/\s+/g, ' ').trim();
                
                results.push({
                    code: iframeCode,
                    url: url,
                    title: gameData.title
                });
                
                // Add a small delay between games in the same batch
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`Error processing game ${url}:`, error);
            }
        }
        
        // Add a longer delay between batches
        if (i < batches.length - 1) {
            console.log('Waiting between batches...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    
    return results;
}

// Update the extractIframesFromHtml function to handle category pages
async function extractIframesFromHtml(html, baseUrl) {
    console.log('Parsing HTML:', html); // 添加日志
    const $ = cheerio.load(html);
    const iframes = [];

    $('iframe').each((i, elem) => {
        const src = $(elem).attr('src');
        console.log('Found iframe:', src); // 添加日志
        if (src) {
            const absoluteSrc = new URL(src, baseUrl).href;
            iframes.push({
                src: absoluteSrc,
                width: $(elem).attr('width') || '100%',
                height: $(elem).attr('height') || '500px'
            });
        }
    });

    return iframes;
}

// Enhanced error handling for the extract endpoint
app.get('/api/extract', async (req, res, next) => {
    const { url: inputUrl, offset = 0, limit = 20 } = req.query;
    const parsedOffset = parseInt(offset, 10);
    const parsedLimit = parseInt(limit, 10);

    if (!inputUrl) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const parsedUrl = new URL(inputUrl);
        let results = [];
        let totalGamesFound = 0; // To store the total number of games before slicing

        if (parsedUrl.hostname === 'www.crazygames.com') {
            if (parsedUrl.pathname.startsWith('/game/')) {
                // Case 1: Specific CrazyGames game page
                console.log(`[${req.id}] Processing CrazyGames single game page: ${inputUrl}`);
                const gameSlug = getGameSlug(inputUrl);
                if (gameSlug) {
                    const gameData = await getGameEmbedUrl(gameSlug);
                    if (gameData && gameData.url) {
                        const iframeCode = `<iframe 
                            src="${gameData.url}" 
                            width="${gameData.width}" 
                            height="${gameData.height}" 
                            scrolling="no" 
                            frameborder="0"
                            allow="autoplay; fullscreen; focus-without-user-activation *;"
                            allowfullscreen>
                        </iframe>`.replace(/\s+/g, ' ').trim();
                        results.push({
                            code: iframeCode,
                            url: inputUrl,
                            title: gameData.title || ''
                        });
                        totalGamesFound = 1; // Only 1 game for a single page
                    } else {
                        console.log(`[${req.id}] No game embed data found for game: ${inputUrl}`);
                    }
                }
            } else if (parsedUrl.pathname === '/new' || parsedUrl.pathname.includes('/category/') || parsedUrl.pathname.includes('/t/')) {
                // Case 2: CrazyGames category/tag page
                console.log(`[${req.id}] Processing CrazyGames category/tag page: ${inputUrl}`);
                const allGameLinks = await getGameLinksFromCategoryPage(inputUrl);
                totalGamesFound = allGameLinks.length; // 这里获取到总数（70个）
                
                // 应用分页
                const linksToProcess = allGameLinks.slice(parsedOffset, parsedOffset + parsedLimit);
                
                if (linksToProcess.length > 0) {
                    console.log(`[${req.id}] Processing games from offset ${parsedOffset}, limit ${parsedLimit} (${linksToProcess.length} in this batch)...`);
                    const processedGames = await processGameLinksInBatches(linksToProcess);
                    results = processedGames;
                }
                
                // 返回结果时包含总数
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.json({ iframes: results, total: totalGamesFound });
            } else {
                // Case 3: Other CrazyGames page (not a specific game or known category/tag page), try generic iframe extraction
                console.log(`[${req.id}] Processing other CrazyGames page (generic iframe extraction): ${inputUrl}`);
                const response = await customAxios.get(inputUrl);
                const html = response.data;
                const extracted = await extractIframesFromHtml(html, inputUrl);
                results = extracted.map(item => ({
                    code: `<iframe src="${item.src}" width="${item.width}" height="${item.height}" scrolling="no" frameborder="0" allowfullscreen></iframe>`,
                    url: item.src,
                    title: ''
                }));
                totalGamesFound = results.length;
            }
        } else {
            // Case 4: Non-CrazyGames URL, perform generic iframe extraction
            console.log(`[${req.id}] Processing non-CrazyGames URL (generic iframe extraction): ${inputUrl}`);
            const response = await customAxios.get(inputUrl);
            const html = response.data;
            const extracted = await extractIframesFromHtml(html, inputUrl);
            results = extracted.map(item => ({
                code: `<iframe src="${item.src}" width="${item.width}" height="${item.height}" scrolling="no" frameborder="0" allowfullscreen></iframe>`,
                url: item.src,
                title: ''
            }));
            totalGamesFound = results.length;
        }

        if (results.length === 0 && parsedOffset === 0) { // Only show error if no results and it's the first fetch
            console.log(`[${req.id}] No iFrames or game embeds found for URL: ${inputUrl}`);
            return res.json({ 
                iframes: [], 
                totalAvailable: 0 
            });
        }
        
        console.log(`[${req.id}] Returning ${results.length} iFrames/embeds (total available: ${totalGamesFound}) for URL: ${inputUrl}`);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json({ iframes: results, total: totalGamesFound });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ 
            error: 'Failed to extract iFrames',
            details: error.message 
        });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

// Start server with enhanced error handling
const server = app.listen(port, '0.0.0.0', (error) => {
    if (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
    console.log(`Server running at http://localhost:${port}`);
    console.log('Server configuration:', {
        port: port,
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid
    });
    console.log(typeof axiosRetry); // 应该输出 "function"
});

// Handle server errors
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Please try a different port or close the application using this port.`);
    } else {
        console.error('Server error:', error);
    }
    process.exit(1);
});

// Handle process termination
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Closing server...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Received SIGINT. Closing server...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    server.close(() => {
        process.exit(1);
    });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    server.close(() => {
        process.exit(1);
    });
}); 