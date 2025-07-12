const express = require('express');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
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

// Helper function to check if URL is a category page (supports pagination)
function isCategoryPage(pathname) {
    // 支持以下格式:
    // /new, /new/2, /new/3
    // /c/action, /c/action/2, /c/action/3
    // /t/flash, /t/flash/2, /t/flash/3
    // /category/xxx, /category/xxx/2
    
    if (pathname === '/new') return true;
    if (pathname.match(/^\/new\/\d+$/)) return true;
    
    if (pathname.includes('/category/')) return true;
    
    if (pathname.match(/^\/[tc]\/[^\/]+(?:\/\d+)?$/)) return true;
    
    return false;
}

// Helper function to get game slug from URL
function getGameSlug(url) {
    const match = url.match(/\/game\/([^\/\?#]+)/);
    return match ? match[1] : null;
}

// Helper function to implement delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to extract embed URL from game page
async function getGameEmbedUrl(gameSlug) {
    const startTime = Date.now();
    const MAX_PROCESSING_TIME = 8000; // 8秒最大处理时间
    
    try {
        console.log(`[${gameSlug}] Starting embed URL extraction`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://www.crazygames.com/'
        };
        
        // Default title fallback
        let title = gameSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        
        // Step 1: Try constructing the new format URL directly (fastest method)
        const constructedEmbedUrl = `https://games.crazygames.com/en_US/${gameSlug}/index.html`;
        console.log(`[${gameSlug}] Trying constructed URL: ${constructedEmbedUrl}`);
        
        try {
            const testResponse = await axios.head(constructedEmbedUrl, { 
                headers, 
                timeout: 3000 // Short timeout for quick test
            });
            if (testResponse.status === 200) {
                console.log(`[${gameSlug}] Constructed URL works! Processing time: ${Date.now() - startTime}ms`);
                return {
                    url: constructedEmbedUrl,
                    title: title,
                    width: '100%',
                    height: '600'
                };
            }
        } catch (constructError) {
            console.log(`[${gameSlug}] Constructed URL failed, trying redirect method`);
        }
        
        // Check if we're running out of time
        if (Date.now() - startTime > MAX_PROCESSING_TIME) {
            console.log(`[${gameSlug}] Timeout reached, using fallback`);
            return {
                url: `https://www.crazygames.com/game/${gameSlug}`,
                title: title,
                width: '100%',
                height: '600'
            };
        }
        
        // Step 2: Try embed redirect (only if constructed URL failed)
        const embedUrl = `https://www.crazygames.com/embed/${gameSlug}`;
        console.log(`[${gameSlug}] Testing embed redirect: ${embedUrl}`);
        
        try {
            const embedResponse = await axios.get(embedUrl, { 
                headers,
                timeout: 4000, // Shorter timeout
                maxRedirects: 3 // Fewer redirects
            });
            
            if (embedResponse.status === 200 && embedResponse.request && embedResponse.request.res && embedResponse.request.res.responseUrl) {
                const finalUrl = embedResponse.request.res.responseUrl;
                console.log(`[${gameSlug}] Found embed URL via redirect: ${finalUrl}. Processing time: ${Date.now() - startTime}ms`);
                return {
                    url: finalUrl,
                    title: title,
                    width: '100%',
                    height: '600'
                };
            }
        } catch (embedError) {
            console.log(`[${gameSlug}] Embed redirect failed: ${embedError.message}`);
        }
        
        // Step 3: Final fallback - return original URL
        console.log(`[${gameSlug}] Using fallback URL. Total processing time: ${Date.now() - startTime}ms`);
        return {
            url: `https://www.crazygames.com/game/${gameSlug}`,
            title: title,
            width: '100%',
            height: '600'
        };
        
    } catch (error) {
        console.error(`[${gameSlug}] Error in getGameEmbedUrl:`, error.message);
        return {
            url: `https://www.crazygames.com/game/${gameSlug}`,
            title: gameSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            width: '100%',
            height: '600'
        };
    }
}

// Helper function to extract game links from a single page
async function getGameLinksFromSinglePage(url, page = 1) {
    try {
        // 如果URL已经包含页面号，直接使用该URL
        let pageUrl = url;
        
        // 只有当URL不包含页面号且page > 1时，才添加页面号
        const urlMatch = url.match(/^(.+?)\/(\d+)$/);
        if (!urlMatch && page > 1) {
            pageUrl = `${url}/${page}`;
        }
        
        console.log(`Fetching single page: ${pageUrl}`);
        console.log(`URL pattern check - original: ${url}, final: ${pageUrl}`);
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Referer': 'https://www.crazygames.com/',
        };

        const response = await axios.get(pageUrl, {
            headers,
            timeout: 30000,
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 500;
            },
            responseType: 'text',
        });

        if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE')) {
            const $ = cheerio.load(response.data);
            const gameLinks = [];
            
            // Extract game links from the HTML using multiple selectors
            const selectors = [
                'a[href*="/game/"]',
                '.game-card a',
                '.game-item a', 
                '.game-tile a',
                '[data-game-url]'
            ];
            
            for (const selector of selectors) {
                $(selector).each((index, element) => {
                    const href = $(element).attr('href') || $(element).attr('data-game-url');
                    if (href && href.includes('/game/') && !href.includes('/game/loading')) {
                        const fullUrl = href.startsWith('http') ? href : `https://www.crazygames.com${href}`;
                        // 确保URL唯一且有效
                        if (!gameLinks.includes(fullUrl) && fullUrl.includes('/game/')) {
                            gameLinks.push(fullUrl);
                        }
                    }
                });
            }
            
            console.log(`Found ${gameLinks.length} games on page. Sample links:`, gameLinks.slice(0, 3));
            return gameLinks;
        }
        
        return [];
    } catch (error) {
        console.error(`Error fetching page ${page}:`, error.message);
        return [];
    }
}

// Helper function to extract game links from category page with improved pagination
async function getGameLinksFromCategoryPage(url) {
    try {
        console.log('Fetching multiple pages from:', url);
        const allGameLinks = [];
        let currentPage = 1;
        let maxPages = 6; // 根据你说的6页来设置
        
        // 检查URL是否已经包含页面号
        const urlMatch = url.match(/^(.+?)\/(\d+)$/);
        let baseUrl = url;
        if (urlMatch) {
            baseUrl = urlMatch[1];
            currentPage = parseInt(urlMatch[2], 10);
            maxPages = currentPage; // 如果URL已经指定页面，只获取该页面
        }
        
        while (currentPage <= maxPages) {
            let pageUrl = baseUrl;
            if (currentPage > 1) {
                pageUrl = `${baseUrl}/${currentPage}`;
            }
            
            console.log(`Fetching page ${currentPage}: ${pageUrl}`);
            
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Referer': 'https://www.crazygames.com/',
            };

            try {
                const response = await axios.get(pageUrl, {
                    headers,
                    timeout: 30000,
                    maxRedirects: 5,
                    validateStatus: function (status) {
                        return status >= 200 && status < 500;
                    },
                    responseType: 'text',
                });

                if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE')) {
                    const $ = cheerio.load(response.data);
                    const pageGameLinks = [];
                    
                    // Extract game links from the HTML using multiple selectors
                    const selectors = [
                        'a[href*="/game/"]',
                        '.game-card a',
                        '.game-item a', 
                        '.game-tile a',
                        '[data-game-url]'
                    ];
                    
                    for (const selector of selectors) {
                        $(selector).each((index, element) => {
                            const href = $(element).attr('href') || $(element).attr('data-game-url');
                            if (href && href.includes('/game/') && !href.includes('/game/loading')) {
                                const fullUrl = href.startsWith('http') ? href : `https://www.crazygames.com${href}`;
                                // 确保URL唯一且有效
                                if (!pageGameLinks.includes(fullUrl) && !allGameLinks.includes(fullUrl) && fullUrl.includes('/game/')) {
                                    pageGameLinks.push(fullUrl);
                                }
                            }
                        });
                    }
                    
                    console.log(`Found ${pageGameLinks.length} games on page ${currentPage}`);
                    
                    if (pageGameLinks.length === 0) {
                        console.log(`No games found on page ${currentPage}, stopping pagination`);
                        break;
                    }
                    
                    allGameLinks.push(...pageGameLinks);
                    
                    // 如果原始URL已经指定了页面号，只获取该页面
                    if (urlMatch) {
                        break;
                    }
                    
                    currentPage++;
                    
                    // 添加延迟避免请求过快
                    if (currentPage <= maxPages) {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }
                } else {
                    console.log(`Invalid response for page ${currentPage}`);
                    break;
                }
            } catch (pageError) {
                console.log(`Error fetching page ${currentPage}:`, pageError.message);
                break;
            }
        }
        
        console.log(`Total found ${allGameLinks.length} game links across ${currentPage - 1} pages`);
        return allGameLinks;
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
async function processGameLinksInBatches(gameLinks, batchSize = 3, maxProcessingTime = 30000) {
    const results = [];
    const batches = [];
    const startTime = Date.now();
    
    // Split links into batches
    for (let i = 0; i < gameLinks.length; i += batchSize) {
        batches.push(gameLinks.slice(i, i + batchSize));
    }
    
    console.log(`Processing ${gameLinks.length} games in ${batches.length} batches (max ${maxProcessingTime}ms)`);
    
    // Process each batch
    for (let i = 0; i < batches.length; i++) {
        // Check if we're running out of time
        if (Date.now() - startTime > maxProcessingTime) {
            console.log(`Batch processing timeout reached after ${Date.now() - startTime}ms, processed ${results.length} games`);
            break;
        }
        
        const batch = batches[i];
        console.log(`Processing batch ${i + 1}/${batches.length} (${Date.now() - startTime}ms elapsed)`);
        
        // Process games in current batch sequentially to avoid rate limiting
        for (const url of batch) {
            try {
                // Check timeout for each game
                if (Date.now() - startTime > maxProcessingTime) {
                    console.log(`Game processing timeout reached, stopping`);
                    return results;
                }
                
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
    const { url: inputUrl, offset = 0, limit = 60, all = false } = req.query;
    const parsedOffset = parseInt(offset, 10);
    const parsedLimit = all === 'true' ? Number.MAX_SAFE_INTEGER : parseInt(limit, 10);

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
            } else if (isCategoryPage(parsedUrl.pathname)) {
                // Case 2: CrazyGames category/tag page (supports /new, /category/, /t/, /c/)
                console.log(`[${req.id}] Processing CrazyGames category/tag page: ${inputUrl}`);
                if (all === 'true') {
                    console.log(`[${req.id}] Extracting ALL games from category page`);
                    // 如果是all=true，获取所有游戏
                    const allGameLinks = await getGameLinksFromCategoryPage(inputUrl);
                    totalGamesFound = allGameLinks.length;
                    const linksToProcess = allGameLinks.slice(parsedOffset, parsedOffset + parsedLimit);
                    if (linksToProcess.length > 0) {
                        console.log(`[${req.id}] Processing games from offset ${parsedOffset}, limit ${parsedLimit} (${linksToProcess.length} in this batch)...`);
                        const processedGames = await processGameLinksInBatches(linksToProcess);
                        results = processedGames;
                    }
                } else {
                    // 正常分页模式：获取当前页面的游戏
                    console.log(`[${req.id}] Getting current page games`);
                    
                    // 直接获取当前页面的游戏
                    let pageToFetch = 1;
                    let actualUrl = inputUrl;
                    const urlMatch = inputUrl.match(/^(.+?)\/(\d+)$/);
                    if (urlMatch) {
                        pageToFetch = parseInt(urlMatch[2], 10);
                        // 对于分页页面，由于JavaScript动态加载问题，先尝试原URL
                        // 如果游戏数量太少，回退到第一页
                    }
                    
                    let pageLinks = await getGameLinksFromSinglePage(actualUrl, pageToFetch);
                    
                    // 如果是分页页面且游戏数量很少，回退到第一页
                    if (urlMatch && pageLinks.length < 5) {
                        console.log(`[${req.id}] Page ${pageToFetch} has only ${pageLinks.length} games, falling back to first page`);
                        const baseUrl = urlMatch[1];
                        pageLinks = await getGameLinksFromSinglePage(baseUrl, 1);
                        actualUrl = baseUrl;
                    }
                    
                    totalGamesFound = pageLinks.length; // 使用当前页面的实际游戏数量
                    
                    // 应用offset和limit
                    const linksToProcess = pageLinks.slice(parsedOffset, parsedOffset + parsedLimit);
                    
                    if (linksToProcess.length > 0) {
                        console.log(`[${req.id}] Processing ${linksToProcess.length} games from page ${pageToFetch}...`);
                        const processedGames = await processGameLinksInBatches(linksToProcess);
                        results = processedGames;
                    }
                }
                
                // 返回结果时包含总数
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                return res.json({ iframes: results, total: totalGamesFound });
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