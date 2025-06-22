// DOM Elements (initial static ones)
const mobileMenu = document.getElementById('mobile-menu');
const navLinks = document.querySelector('.nav-links');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const extractBtn = document.getElementById('extract-btn'); // This button is now directly in HTML
const generateBtn = document.getElementById('generate-btn'); // This button is now directly in HTML
// copyAllBtn, exportTxtBtn, exportExcelBtn are now dynamically managed
const resultsListContainer = document.getElementById('results-list'); // This is the main container for dynamic results

// Mobile Menu Toggle (unchanged)
mobileMenu.addEventListener('click', () => {
    navLinks.classList.toggle('active');
});

// Tab Switching (unchanged logic, only clearResults is called)
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
const NETWORK_TIMEOUT = 240000; // 4 minutes (Updated timeout as per user)

// API Configuration
const API_BASE_URL = window.location.origin;

// Utility function for delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced fetch with retry mechanism (unchanged logic from last successful version)
async function fetchWithRetry(url, options = {}, retries = RETRY_COUNT) {
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

// --- START NEW/MODIFIED STATE AND FUNCTIONS FOR DYNAMIC UI AND PAGINATION ---
let allAccumulatedIframes = [];
let currentOffset = 0;
let totalIframesAvailable = 0;
const PAGE_SIZE = 20; // 定义每次获取的iFrame数量

// Dynamic UI elements references
let resultsSummaryElement = null;
let totalIframesCountSpan = null;
let copyAllBtnElement = null; // Will be the "Copy All iFrames" button
let paginationControlsElement = null;
let loadMoreBtnElement = null; // Will be the "Load More iFrames" button

// Function to create or update the results summary section
function ensureResultsSummary() {
    if (!resultsSummaryElement || !resultsListContainer.contains(resultsSummaryElement)) {
        resultsSummaryElement = document.createElement('div');
        resultsSummaryElement.className = 'results-summary';
        resultsListContainer.prepend(resultsSummaryElement); // Prepend to the main container

        totalIframesCountSpan = document.createElement('span');
        totalIframesCountSpan.className = 'total-iframes-count';
        totalIframesCountSpan.textContent = 'Found 0 iFrame(s)'; // Initial text
        resultsSummaryElement.appendChild(totalIframesCountSpan);

        copyAllBtnElement = document.createElement('button');
        copyAllBtnElement.className = 'copy-all-btn';
        copyAllBtnElement.innerHTML = '<i class="fas fa-copy"></i> Copy All iFrames';
        copyAllBtnElement.addEventListener('click', copyAllCodes);
        resultsSummaryElement.appendChild(copyAllBtnElement);
    }
}

// Function to create or update pagination controls
function ensurePaginationControls() {
    if (!paginationControlsElement || !resultsListContainer.contains(paginationControlsElement)) {
        paginationControlsElement = document.createElement('div');
        paginationControlsElement.className = 'pagination-controls';
        resultsListContainer.appendChild(paginationControlsElement); // Append after results

        loadMoreBtnElement = document.createElement('button');
        loadMoreBtnElement.className = 'load-more-btn';
        loadMoreBtnElement.textContent = 'Load More iFrames';
        loadMoreBtnElement.addEventListener('click', extractMoreIframes);
        paginationControlsElement.appendChild(loadMoreBtnElement);
    }
}

function updateTotalCountDisplay() {
    ensureResultsSummary(); // Ensure the span exists
    if (totalIframesCountSpan) {
        totalIframesCountSpan.textContent = `Found ${allAccumulatedIframes.length} iFrame(s)`;
        // Apply a class for animation/transition on update
        totalIframesCountSpan.classList.add('count-update-animation');
        setTimeout(() => {
            totalIframesCountSpan.classList.remove('count-update-animation');
        }, 500); // Remove class after animation
    }
}

function updateLoadMoreButtonState() {
    ensurePaginationControls(); // Ensure the button exists
    if (loadMoreBtnElement) { // Check if it exists after ensurePaginationControls
        if (allAccumulatedIframes.length < totalIframesAvailable) {
            loadMoreBtnElement.style.display = 'block';
            loadMoreBtnElement.disabled = false; // Ensure it's enabled if there's more to load
        } else {
            loadMoreBtnElement.style.display = 'none'; // Hide if all loaded
            if (totalIframesAvailable > 0 && allAccumulatedIframes.length === totalIframesAvailable) {
                showSuccess('All iFrames loaded!');
            }
        }
    }
}

async function extractMoreIframes() {
    const sourceUrl = document.getElementById('source-url').value;
    if (loadMoreBtnElement) loadMoreBtnElement.disabled = true; // Disable button to prevent multiple clicks
    showLoading('Loading more iFrames...');

    try {
        const response = await fetchWithRetry(`/api/extract?url=${encodeURIComponent(sourceUrl)}&offset=${currentOffset}&limit=${PAGE_SIZE}`);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (data.iframes && data.iframes.length > 0) {
            allAccumulatedIframes = allAccumulatedIframes.concat(data.iframes);
            currentOffset += data.iframes.length; // Update offset by actual fetched count
            totalIframesAvailable = data.totalAvailable || allAccumulatedIframes.length; // Get total from backend if provided

            displayResults(data.iframes, true); // True means append
            updateTotalCountDisplay();
            updateLoadMoreButtonState(); // Update button visibility based on new count
        } else {
            // No more iframes returned
            totalIframesAvailable = allAccumulatedIframes.length; // Set total to current accumulated if no more coming
            updateLoadMoreButtonState(); // Hide load more button
            if (allAccumulatedIframes.length === 0 && currentOffset === 0) { // Only show error if no results at all
                 showError('No iFrames found on the specified page.');
            }
        }
    } catch (error) {
        console.error('Extraction error:', error);
        showError(error.message || 'Failed to extract iFrames. Please try again.');
    } finally {
        hideLoading();
        if (loadMoreBtnElement) loadMoreBtnElement.disabled = false; // Re-enable button
    }
}


// Extract iFrames (initial click, resets everything)
extractBtn.addEventListener('click', async () => {
    const sourceUrl = document.getElementById('source-url').value;
    if (!sourceUrl) {
        showError('Please enter a valid URL');
        return;
    }

    // Reset state for a new extraction
    allAccumulatedIframes = [];
    currentOffset = 0;
    totalIframesAvailable = 0;
    clearResults(); // Clear display and existing dynamic elements

    try {
        showLoading('Scanning pages for iFrames...');
        
        if (!navigator.onLine) {
            throw new Error('No internet connection. Please check your network and try again.');
        }
        
        console.log('Starting extraction for URL:', sourceUrl);
        const response = await fetchWithRetry(`/api/extract?url=${encodeURIComponent(sourceUrl)}&offset=${currentOffset}&limit=${PAGE_SIZE}`);
        console.log('Received response:', response.status);
        const data = await response.json();
        console.log('Parsed response data:', data);
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        if (!data.iframes || data.iframes.length === 0) {
            showError('No iFrames found on the specified page.');
            updateTotalCountDisplay();
            updateLoadMoreButtonState();
            return;
        }
        
        allAccumulatedIframes = data.iframes;
        currentOffset += data.iframes.length;
        totalIframesAvailable = data.totalAvailable || data.iframes.length;

        displayResults(data.iframes, false); // False means not append, it's the first fetch
        updateTotalCountDisplay();
        updateLoadMoreButtonState();
        
    } catch (error) {
        console.error('Extraction error:', error);
        showError(error.message || 'Failed to extract iFrames. Please try again.');
        updateTotalCountDisplay(); // Update count even on error, e.g., to 0
        updateLoadMoreButtonState(); // Ensure button state is correct
    } finally {
        hideLoading();
    }
});

// Generate iFrame (modified to reset state)
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
    
    // Reset state for single generation
    allAccumulatedIframes = [];
    currentOffset = 0;
    totalIframesAvailable = 0;
    clearResults(); // Clear all previous results and summary/pagination
    
    const generatedItem = { code: iframeCode, url: targetUrl, title: 'Generated iFrame' };
    displayResults([generatedItem], false); // Display single result
    updateTotalCountDisplay(); // Set count to 1
    updateLoadMoreButtonState(); // Hide load more btn
});

// Copy All Results (unchanged logic, now uses allAccumulatedIframes)
// Note: This function is called by copyAllCodes(), which is attached to dynamically created button
// So, the event listener directly on copyAllBtn is no longer needed here if it was defined
// as copyAllBtn will be dynamically created.
// This block is left here if you previously had it as an event listener for a static button.
/*
copyAllBtn.addEventListener('click', () => {
    if (allAccumulatedIframes.length === 0) {
        showError('No results to copy');
        return;
    }
    const resultsContent = allAccumulatedIframes.map(item => item.code).join('\n\n');
    if (resultsContent) {
        copyToClipboard(resultsContent);
        } else {
            showError('No results to copy');
    }
});
*/

// Export as TXT (unchanged logic, now uses allAccumulatedIframes)
/*
exportTxtBtn.addEventListener('click', () => {
    if (allAccumulatedIframes.length === 0) {
        showError('No results to export');
        return;
    }
    const content = allAccumulatedIframes.map(item => item.code).join('\n\n');
    if (content) {
        downloadFile('iframes.txt', content);
    } else {
        showError('No results to export');
    }
});
*/

// Export as Excel (unchanged logic, now uses allAccumulatedIframes)
/*
exportExcelBtn.addEventListener('click', () => {
    if (allAccumulatedIframes.length === 0) {
        showError('No results to export');
        return;
    }
    const codes = allAccumulatedIframes.map(item => item.code);
    if (codes.length) {
        const csvContent = codes.map(code => {
            const escaped = code.replace(/"/g, '""');
            return `"${escaped}"`;
        }).join('\n');
        
        downloadFile('iframes.csv', csvContent);
    } else {
        showError('No results to export');
    }
});
*/


// Utility Functions
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

// Modified displayResults to append or replace, and use resultsListContainer
function displayResults(results, append = false) {
    // Only clear the individual iframe items if not appending
    if (!append) {
        // Clear only the actual iframe result items, not the summary/pagination
        const currentItems = resultsListContainer.querySelectorAll('.result-item');
        currentItems.forEach(item => item.remove());
    }
    
    if (!results || !results.length) {
        if (!append) { // Only show "No iframes found" if no results at all
            resultsListContainer.innerHTML = '<div class="no-results">No iFrames found</div>';
        }
        return;
    }

    // Ensure summary and pagination elements exist before appending results
    ensureResultsSummary();
    ensurePaginationControls();
    
    results.forEach(item => {
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';
        resultItem.innerHTML = `
            <pre class="result-code">${escapeHtml(item.code)}</pre>
        `;
        // Append individual results BEFORE the pagination controls
        resultsListContainer.insertBefore(resultItem, paginationControlsElement);
    });

    // Ensure scroll to bottom to see new results
    resultsListContainer.scrollTop = resultsListContainer.scrollHeight;
}

// Function to copy all codes (global, called from HTML via onclick)
function copyAllCodes() { // This function is referenced by onclick in HTML
    if (allAccumulatedIframes.length === 0) {
        showError('No results to copy');
        return;
    }
    const codesText = allAccumulatedIframes.map(item => item.code).join('\n\n');
    copyToClipboard(codesText);
    }


function clearResults() {
    // Remove all dynamically added children from the main results container
    resultsListContainer.innerHTML = ''; 

    // Reset internal state
    allAccumulatedIframes = [];
    currentOffset = 0;
    totalIframesAvailable = 0;

    // Reset dynamic element references (important for re-creation)
    resultsSummaryElement = null;
    totalIframesCountSpan = null;
    copyAllBtnElement = null;
    paginationControlsElement = null;
    loadMoreBtnElement = null;

    updateTotalCountDisplay(); // This will re-create summary if needed and show 0
    updateLoadMoreButtonState(); // This will re-create pagination if needed and hide button
}


// copyToClipboard, fallbackCopyToClipboard, downloadFile, showError, showSuccess, showLoading, hideLoading, escapeHtml - all unchanged, but adjusted to use resultsListContainer if applicable

function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            showSuccess('Copied to clipboard!');
        }).catch(() => {
            fallbackCopyToClipboard(text);
        });
    } else {
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
    // Clear previous results and show error
    resultsListContainer.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    resultsListContainer.appendChild(errorDiv);
    // Ensure all dynamic elements are removed/reset on error
    // clearResults(true); // This might cause issues with re-init. Let's just remove the error message when new content comes
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
    // Clear previous results before showing loading
    resultsListContainer.innerHTML = ''; 
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-message">
                ${message}<br>
                <small>This may take a few moments...</small>
        </div>
    `;
    resultsListContainer.appendChild(loading);
}

function hideLoading() {
    const loading = resultsListContainer.querySelector('.loading');
    if (loading) loading.remove();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- START NEW/MODIFIED CSS FOR UI/UX ---
const style = document.createElement('style');
style.textContent = `
    /* Universal box-sizing for consistency */
    *, *::before, *::after {
        box-sizing: border-box;
    }

    /* General layout for the main content area, assuming there's a wrapper */
    body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; /* A more modern font */
        line-height: 1.6;
        color: #333;
        background-color: #f4f7f6; /* Light background */
        margin: 0;
        padding: 2rem; /* Overall page padding */
    }

    /* Main card container for the tabs section */
    .tab-section-wrapper { /* Add this class to a div around your tabs and content */
        max-width: 900px;
        margin: 2rem auto; /* Center the card on the page */
        background: white;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        padding: 2rem; /* Internal padding for the card */
    }

    /* Tab buttons styling */
    .tab-buttons { /* Add this class to the div containing your tab buttons */
        display: flex;
        margin-bottom: 1.5rem;
        border-bottom: 1px solid #eee;
        padding-bottom: 0.5rem;
    }

    .tab-btn {
        background: none;
        border: none;
        padding: 0.75rem 1.5rem;
        cursor: pointer;
        font-size: 1.1rem;
        color: #666;
        transition: color 0.2s ease, border-bottom 0.2s ease;
        border-bottom: 3px solid transparent; /* For active indicator */
        margin-right: 1rem; /* Space between buttons */
        font-weight: 500;
    }

    .tab-btn.active {
        color: var(--primary-color);
        border-bottom: 3px solid var(--primary-color);
        font-weight: 600;
    }

    .tab-btn:hover:not(.active) {
        color: #333;
    }

    /* Adjust h2 for better spacing */
    h2 {
        font-size: 1.8rem;
        margin-top: 0; /* Remove default top margin */
        margin-bottom: 1.5rem;
        color: var(--primary-color);
        font-weight: 700;
    }

    /* Input group for URL and label */
    .input-group {
        display: flex; /* Use flexbox for horizontal layout */
        align-items: center; /* Vertically align label and input */
        gap: 0.8rem; /* Space between label and input */
        margin-bottom: 1.5rem; /* Space below URL input */
    }

    .input-group label {
        flex-shrink: 0; /* Prevent label from shrinking */
        width: 3rem; /* Give label a fixed width for consistent alignment */
        text-align: right; /* Align label text to the right */
        padding-right: 0.5rem; /* Small padding after label */
        color: #333; /* Darker color for labels */
        font-weight: 500;
    }

    .input-group input[type="url"] {
        flex-grow: 1; /* Allow input to take remaining space */
        padding: 0.75rem 1rem;
        border: 1px solid #ccc;
        border-radius: var(--border-radius);
        font-size: 1rem;
        transition: border-color 0.2s ease;
    }

    .input-group input[type="url"]:focus {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.25); /* Subtle focus ring */
    }

    /* Get iFrames button and reminder text container */
    .extract-controls {
        display: flex;
        align-items: center;
        gap: 1.5rem; /* Increased space between button and text */
        margin-bottom: 2rem; /* More space below this section before results */
        justify-content: flex-start;
        padding-left: calc(3rem + 0.8rem + 0.5rem); /* Align with input field's start: label-width + gap + label-padding-right */
    }

    #extract-btn { /* Specific ID for the button */
        background: var(--primary-gradient);
        color: white;
        border: none; /* Ensure no default border */
        padding: 0.75rem 1.5rem;
        border-radius: var(--border-radius);
        cursor: pointer;
        font-size: 1rem;
        transition: var(--transition);
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(3, 150, 255, 0.2); /* Added subtle shadow */
        display: inline-flex; /* Use inline-flex for button content alignment */
        align-items: center; /* Align icon and text inside button */
        justify-content: center;
    }

    #extract-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(3, 150, 255, 0.3);
    }

    .extract-reminder {
        font-size: 0.95rem; /* Slightly larger font */
        color: #555;
        white-space: nowrap;
        line-height: 1.5; /* Ensure text line height is normal for vertical alignment */
    }

    /* Main results container */
    .results-list-container { /* This is the main container for dynamic results */
        background: white; /* Changed to white background as per screenshot */
        border-radius: var(--border-radius);
        padding: 1.5rem; /* Increased padding */
        margin-top: 1rem; /* Space from above sections */
        box-shadow: 0 2px 10px rgba(0,0,0,0.05); /* Subtle shadow for the container */
    }

    .results-summary { /* Dynamically created header for results */
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem; /* More space below summary */
        padding-bottom: 1.5rem; /* More padding below for the border */
        border-bottom: 1px solid var(--light-gray);
    }

    .total-iframes-count {
        font-size: 1.8rem; /* Increased font size for impact (approx double of base text) */
        font-weight: 700; /* Bolder font */
        color: var(--primary-color);
        transition: font-size 0.3s ease-out, transform 0.1s ease-out; /* Smooth transition and scale for animation */
    }

    /* Animation for number update */
    .total-iframes-count.count-update-animation {
        animation: countPop 0.3s forwards;
    }

    @keyframes countPop {
        0% { transform: scale(1); }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); }
    }

    .copy-all-btn { /* Dynamically created copy all button */
        background: var(--primary-gradient);
        color: white;
        border: none;
        padding: 0.6rem 1.2rem; /* Slightly adjusted padding */
        border-radius: var(--border-radius);
        cursor: pointer;
        font-size: 0.9rem;
        transition: var(--transition);
        box-shadow: 0 2px 8px rgba(3, 150, 255, 0.2);
    }

    .copy-all-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(3, 150, 255, 0.3);
    }

    /* Individual result item styling */
    .result-item {
        background: var(--light-gray); /* Light gray background for each iframe block */
        border-radius: var(--border-radius);
        padding: 1.2rem; /* Increased padding */
        margin-bottom: 1.2rem; /* Increased spacing between items */
        box-shadow: 0 1px 5px rgba(0,0,0,0.03); /* Very subtle shadow for items */
    }
    
    .result-item:last-child {
        margin-bottom: 0; /* No margin after the last item */
    }

    .result-code {
        background: #e9ecef; /* Slightly darker background for code area */
        padding: 1rem;
        border-radius: var(--border-radius);
        overflow-x: auto;
        font-family: monospace;
        font-size: 0.85rem; /* Slightly smaller font for code */
        line-height: 1.5;
        resize: vertical;
        white-space: pre-wrap; /* Allow long lines to wrap */
        word-wrap: break-word; /* Break long words */
        margin: 0;
        color: #333; /* Darker text for readability */
    }

    .result-title, .result-original-url {
        font-size: 0.9rem;
        color: #777;
        margin-top: 0.8rem; /* Space above title/url */
        word-break: break-all; /* Ensure long URLs don't overflow */
    }
    
    .result-original-url a {
        color: var(--primary-color);
        text-decoration: none;
    }
    .result-original-url a:hover {
        text-decoration: underline;
    }

    /* Pagination controls */
    .pagination-controls {
        text-align: center;
        margin-top: 2rem; /* More space above pagination */
        padding-top: 1.5rem;
        border-top: 1px solid var(--light-gray); /* Separator line */
    }

    .load-more-btn {
        background: #6c757d;
        color: white;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: var(--border-radius);
        cursor: pointer;
        font-size: 1rem;
        transition: background 0.3s ease;
        box-shadow: 0 2px 8px rgba(108,117,125,0.2);
    }

    .load-more-btn:hover {
        background: #5a6268;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(108,117,125,0.3);
    }

    /* Common elements/utilities */
    .error-message, .success-message, .loading, .no-results {
        padding: 1rem;
        margin-bottom: 1rem; /* Consistent spacing */
        border-radius: var(--border-radius);
    }

    .error-message {
        color: #dc3545;
        background: #f8d7da;
    }

    .success-message {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 1rem 2rem;
        z-index: 1000;
        box-shadow: 0 4px 10px rgba(0,0,0,0.1);
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
        font-size: 1.1rem;
    }

    .loading-message small {
        font-size: 0.85rem;
        color: #888;
    }

    .no-results {
        text-align: center;
        padding: 2rem;
        color: #666;
    }


    /* Variables */
    :root {
        --primary-color: #007bff;
        --primary-gradient: linear-gradient(45deg, #007bff, #0056b3);
        --light-gray: #f8f9fa;
        --border-radius: 8px;
        --transition: all 0.2s ease-in-out;
    }

    /* Keyframe animations */
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style); 