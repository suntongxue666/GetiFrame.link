// DOM Elements
const mobileMenu = document.getElementById('mobile-menu');
const navLinks = document.querySelector('.nav-links');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const extractBtn = document.getElementById('extract-btn');
const generateBtn = document.getElementById('generate-btn');
const copyAllBtn = document.getElementById('copy-all');
const exportTxtBtn = document.getElementById('export-txt');
const exportExcelBtn = document.getElementById('export-excel');
const resultsList = document.getElementById('results-list');

// Mobile Menu Toggle
mobileMenu.addEventListener('click', () => {
    navLinks.classList.toggle('active');
});

// Tab Switching
tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        const tabId = button.getAttribute('data-tab');
        
        // Update active states
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        
        button.classList.add('active');
        document.getElementById(tabId).classList.add('active');
        
        // Clear results when switching tabs
        clearResults();
    });
});

// Retry configuration
const RETRY_COUNT = 3;
const RETRY_DELAY = 2000; // 2 seconds
const NETWORK_TIMEOUT = 120000; // 2 minutes (Increased to 2 minutes for category pages)

// API Configuration
const API_BASE_URL = window.location.origin;

// Utility function for delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced fetch with retry mechanism
async function fetchWithRetry(url, options = {}, retries = RETRY_COUNT) {
    // Ensure URL is absolute
    const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT);
    
    try {
        console.log('Attempting request to:', fullUrl);
        const response = await fetch(fullUrl, {
            ...options,
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return response;
    } catch (error) {
        clearTimeout(timeout);
        
        if (error.name === 'AbortError') {
            throw new Error('Request timed out. Please check your network connection and try again.');
        }
        
        if (retries > 0) {
            console.log(`Retrying... ${RETRY_COUNT - retries + 1}/${RETRY_COUNT}`);
            await sleep(RETRY_DELAY);
            return fetchWithRetry(fullUrl, options, retries - 1);
        }
        
        if (!navigator.onLine) {
            throw new Error('No internet connection. Please check your network and try again.');
        }
        
        throw new Error(`Network request failed: ${error.message}`);
    }
}

// Extract iFrames with enhanced error handling
extractBtn.addEventListener('click', async () => {
    const sourceUrl = document.getElementById('source-url').value;
    if (!sourceUrl) {
        showError('Please enter a valid URL');
        return;
    }

    try {
        showLoading('Scanning pages for iFrames...');
        
        // Check internet connection first
        if (!navigator.onLine) {
            throw new Error('No internet connection. Please check your network and try again.');
        }
        
        console.log('Starting extraction for URL:', sourceUrl);
        const response = await fetchWithRetry(`/api/extract?url=${encodeURIComponent(sourceUrl)}`);
        console.log('Received response:', response.status);
        const data = await response.json();
        console.log('Parsed response data:', data);
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        if (!data.iframes || data.iframes.length === 0) {
            showError('No iFrames found on the specified page.');
            return;
        }
        
        displayResults(data.iframes, data.totalPages);
    } catch (error) {
        console.error('Extraction error:', error);
        showError(error.message || 'Failed to extract iFrames. Please try again.');
    } finally {
        hideLoading();
    }
});

// Generate iFrame
generateBtn.addEventListener('click', () => {
    const targetUrl = document.getElementById('target-url').value;
    if (!targetUrl) {
        showError('Please enter a valid URL');
        return;
    }

    const width = document.getElementById('width').value;
    const height = document.getElementById('height').value;
    const scrolling = document.getElementById('scrolling').value;
    const border = document.getElementById('border').value;

    const iframeCode = generateIFrameCode(targetUrl, width, height, scrolling, border);
    displayResults([iframeCode]);
});

// Copy All Results
copyAllBtn.addEventListener('click', () => {
    const codesArea = document.querySelector('.codes-area');
    if (codesArea && codesArea.value) {
        copyToClipboard(codesArea.value);
    } else {
        const results = Array.from(resultsList.children)
            .map(item => {
                const codeElement = item.querySelector('.result-code');
                return codeElement ? codeElement.textContent : '';
            })
            .filter(code => code)
            .join('\n\n');
        
        if (results) {
            copyToClipboard(results);
        } else {
            showError('No results to copy');
        }
    }
});

// Export as TXT
exportTxtBtn.addEventListener('click', () => {
    const codesArea = document.querySelector('.codes-area');
    let content;
    
    if (codesArea && codesArea.value) {
        content = codesArea.value;
    } else {
        content = Array.from(resultsList.children)
            .map(item => {
                const codeElement = item.querySelector('.result-code');
                return codeElement ? codeElement.textContent : '';
            })
            .filter(code => code)
            .join('\n\n');
    }
    
    if (content) {
        downloadFile('iframes.txt', content);
    } else {
        showError('No results to export');
    }
});

// Export as Excel
exportExcelBtn.addEventListener('click', () => {
    const codesArea = document.querySelector('.codes-area');
    let codes;
    
    if (codesArea && codesArea.value) {
        codes = codesArea.value.split('\n\n').filter(code => code.trim());
    } else {
        codes = Array.from(resultsList.children)
            .map(item => {
                const codeElement = item.querySelector('.result-code');
                return codeElement ? codeElement.textContent : '';
            })
            .filter(code => code);
    }
    
    if (codes.length) {
        const csvContent = codes.map(code => {
            // Properly escape the code for CSV format
            const escaped = code.replace(/"/g, '""');
            return `"${escaped}"`;
        }).join('\n');
        
        downloadFile('iframes.csv', csvContent);
    } else {
        showError('No results to export');
    }
});

// Utility Functions
async function extractIFrames(url) {
    try {
        const response = await fetch(`/api/extract?url=${encodeURIComponent(url)}`);
        if (!response.ok) throw new Error('Failed to fetch iframes');
        const data = await response.json();
        return data.iframes;
    } catch (error) {
        throw new Error('Failed to extract iframes. Please check the URL and try again.');
    }
}

function generateIFrameCode(url, width, height, scrolling, border) {
    const style = border === 'none' ? 
        'style="border: none;"' : 
        'style="border: 1px solid #ccc;"';
    
    return `<iframe src="${url}" 
        width="${width}" 
        height="${height}" 
        scrolling="${scrolling}" 
        ${style} 
        allowfullscreen>
    </iframe>`.replace(/\s+/g, ' ').trim();
}

function displayResults(results, totalPages) {
    clearResults();
    
    if (!results || !results.length) {
        resultsList.innerHTML = '<div class="no-results">No iframes found</div>';
        return;
    }

    // Create a container for all iframes
    const container = document.createElement('div');
    container.className = 'results-container';

    // Add a simple header with count and copy button
    const header = document.createElement('div');
    header.className = 'results-header';
    header.innerHTML = `
        <div class="results-count">Found ${results.length} iFrame(s)</div>
        <button class="copy-all-btn" onclick="copyAllCodes()">
            <i class="fas fa-copy"></i> Copy All iFrames
        </button>
    `;
    container.appendChild(header);

    // Add text area with all iframe codes
    const codesArea = document.createElement('textarea');
    codesArea.className = 'codes-area';
    codesArea.readOnly = true;
    codesArea.value = results.map(item => item.code).join('\n\n');
    container.appendChild(codesArea);

    resultsList.appendChild(container);
}

// Function to copy all codes
function copyAllCodes() {
    const codesArea = document.querySelector('.codes-area');
    if (codesArea) {
        codesArea.select();
        document.execCommand('copy');
        showSuccess('All iFrame codes copied!');
    }
}

function clearResults() {
    resultsList.innerHTML = '';
}

function copyResult(button) {
    const code = button.closest('.result-item').querySelector('.result-code').textContent;
    copyToClipboard(code);
    
    // Show copied feedback
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-check"></i> Copied';
    button.disabled = true;
    
    setTimeout(() => {
        button.innerHTML = originalText;
        button.disabled = false;
    }, 2000);
}

function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        // For modern browsers
        navigator.clipboard.writeText(text).then(() => {
            showSuccess('Copied to clipboard!');
        }).catch(() => {
            // Fallback to older method if clipboard API fails
            fallbackCopyToClipboard(text);
        });
    } else {
        // Fallback for older browsers or non-HTTPS
        fallbackCopyToClipboard(text);
    }
}

function fallbackCopyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showSuccess('Copied to clipboard!');
    } catch (err) {
        console.error('Failed to copy:', err);
        showError('Failed to copy to clipboard');
    } finally {
        document.body.removeChild(textarea);
    }
}

function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    showSuccess(`Downloaded as ${filename}`);
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    resultsList.innerHTML = '';
    resultsList.appendChild(errorDiv);
}

function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    document.body.appendChild(successDiv);
    
    setTimeout(() => {
        successDiv.remove();
    }, 2000);
}

function showLoading(message = 'Loading...') {
    resultsList.innerHTML = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <div class="loading-message">
                ${message}<br>
                <small>This may take a few moments...</small>
            </div>
        </div>
    `;
}

function hideLoading() {
    const loading = resultsList.querySelector('.loading');
    if (loading) loading.remove();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Add some CSS for messages and loading
const style = document.createElement('style');
style.textContent = `
    .error-message {
        color: #dc3545;
        padding: 1rem;
        background: #f8d7da;
        border-radius: var(--border-radius);
        margin-bottom: 1rem;
    }

    .success-message {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 1rem 2rem;
        border-radius: var(--border-radius);
        animation: fadeIn 0.3s ease;
    }

    .loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 2rem;
    }

    .loading-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid var(--light-gray);
        border-top-color: var(--primary-color);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-bottom: 1rem;
    }

    .loading-message {
        color: #666;
    }

    .result-item {
        background: white;
        border-radius: var(--border-radius);
        padding: 1rem;
        margin-bottom: 1rem;
    }

    .result-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
    }

    .result-number {
        font-weight: 500;
        color: #666;
    }

    .copy-btn {
        background: none;
        border: none;
        color: var(--primary-color);
        cursor: pointer;
        padding: 0.5rem;
        border-radius: var(--border-radius);
        transition: var(--transition);
    }

    .copy-btn:hover {
        background: var(--light-gray);
    }

    .result-code {
        background: var(--light-gray);
        padding: 1rem;
        border-radius: var(--border-radius);
        overflow-x: auto;
        font-family: monospace;
        margin: 0;
    }

    .no-results {
        text-align: center;
        padding: 2rem;
        color: #666;
    }

    .results-container {
        background: white;
        border-radius: var(--border-radius);
        padding: 1rem;
        margin-top: 1rem;
    }

    .results-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--light-gray);
    }

    .results-count {
        font-size: 1.1rem;
        font-weight: 500;
        color: var(--primary-color);
    }

    .copy-all-btn {
        background: var(--primary-gradient);
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: var(--border-radius);
        cursor: pointer;
        font-size: 0.9rem;
        transition: var(--transition);
    }

    .copy-all-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(3, 150, 255, 0.2);
    }

    .codes-area {
        width: 100%;
        min-height: 200px;
        padding: 1rem;
        border: 1px solid var(--light-gray);
        border-radius: var(--border-radius);
        font-family: monospace;
        font-size: 0.9rem;
        line-height: 1.4;
        resize: vertical;
        white-space: pre;
        overflow-x: auto;
    }

    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style); 