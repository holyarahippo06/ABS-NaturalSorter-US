// ==UserScript==
// @name         ABS-NaturalSorter
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatically sorts audiobooks naturally across shelves and re-initializes on SPA navigation.
// @author       Holy AraHippo
// @match        INSERT_YOUR_AUDIOBOOKSHELF_LIBRARY_TITLE_SORT_LINK_HERE
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Prevent script running in frames
    if (window.self !== window.top) {
        return;
    }

    console.log("ABS-NaturalSorter v1.0 Initializing...");

    // --- Debounce Function ---
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // --- Natural Sort Function ---
    function naturalSort(a, b) {
        const re = /(\d+)/g; const isString = (s) => typeof s === 'string';
        const aString = isString(a) ? a : ''; const bString = isString(b) ? b : '';
        const aParts = aString.replace(re, '\0$1\0').split('\0');
        const bParts = bString.replace(re, '\0$1\0').split('\0');
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aPart = aParts[i] || ''; const bPart = bParts[i] || '';
            const aNum = parseFloat(aPart); const bNum = parseFloat(bPart);
            if (!isNaN(aNum) && !isNaN(bNum)) { if (aNum !== bNum) return aNum - bNum; }
            else { const aLower = aPart.toLowerCase(); const bLower = bPart.toLowerCase(); if (aLower !== bLower) return aLower < bLower ? -1 : 1; }
        } return 0;
    }

    // --- Coordinate Parsing ---
    function parseTranslate3d(transformString) {
        const match = /translate3d\(\s*(-?[\d.]+)[p]?[x]?\s*,\s*(-?[\d.]+)[p]?[x]?\s*,\s*(-?[\d.]+)[p]?[x]?\s*\)/i.exec(transformString);
        if (match && match.length >= 4) return { x: parseFloat(match[1]), y: parseFloat(match[2]), z: parseFloat(match[3]) };
        return null;
    }

    // --- Global State ---
    let bookshelfObserver = null; // Observer specifically for the bookshelf content
    let currentBookshelfElement = null; // Reference to the currently observed bookshelf
    let sortDebounceTimer = null; // Store the timer ID for debouncing

    // Debounced sort function reference
    const debouncedSort = debounce(sortBooksNaturally, 750); // 750ms delay

    // --- Main Sorting Logic ---
    function sortBooksNaturally() {
        if (!currentBookshelfElement || !document.body.contains(currentBookshelfElement)) {
            console.warn("AutoSort: Bookshelf element not found or detached when sort triggered.");
            cleanupBookshelfObserver(); // Clean up if bookshelf is gone
            return;
        }
        console.log("AutoSort: Running sortBooksNaturally...");
        if (bookshelfObserver) bookshelfObserver.disconnect(); // Disconnect before sorting

        try {
            const allBooksData = []; const shelves = Array.from(currentBookshelfElement.querySelectorAll('div[id^="shelf-"]'));
            let totalBooksFound = 0;
            shelves.forEach(shelf => {
                const shelfCards = Array.from(shelf.querySelectorAll(':scope > div[id^="book-card-"]'));
                shelfCards.forEach((card) => {
                    totalBooksFound++; const titleElement = card.querySelector('p[cy-id="title"]');
                    const title = titleElement ? titleElement.textContent.trim() : `ZZZ_NO_TITLE_${totalBooksFound}`;
                    const transform = card.style.transform; const coords = parseTranslate3d(transform);
                    if(coords && transform) allBooksData.push({element: card, title: title, originalShelf: shelf, originalTransform: transform, originalX: coords.x});
                    else console.warn(`Skipping card in ${shelf.id}: missing data. Title: ${title}`);
                });
            });

            if (allBooksData.length === 0) { console.log("AutoSort: No valid books found."); return; }
            console.log(`AutoSort Step 1: Gathered ${allBooksData.length} books.`);

            const targetGridSlots = [];
            shelves.forEach((shelf) => {
                const originalShelfCardsForGrid = allBooksData.filter(b => b.originalShelf === shelf).sort((a, b) => a.originalX - b.originalX);
                originalShelfCardsForGrid.forEach(b => targetGridSlots.push({ targetShelf: shelf, targetTransform: b.originalTransform }));
            });

            if (allBooksData.length !== targetGridSlots.length) { console.error(`AutoSort Error: Book count (${allBooksData.length}) vs grid slots (${targetGridSlots.length}) mismatch.`); return; }
            console.log(`AutoSort Step 2: Created target grid with ${targetGridSlots.length} slots.`);

            allBooksData.sort((a, b) => naturalSort(a.title, b.title));
            console.log("AutoSort Step 3: Books sorted by title.");

            console.log("AutoSort Step 4: Applying sorted books...");
            allBooksData.forEach((bookData, index) => {
                const targetSlot = targetGridSlots[index];
                if (targetSlot?.targetShelf && targetSlot.targetTransform) {
                    if (bookData.element.parentElement !== targetSlot.targetShelf || bookData.element.style.transform !== targetSlot.targetTransform) {
                        targetSlot.targetShelf.appendChild(bookData.element);
                        bookData.element.style.transform = targetSlot.targetTransform;
                        bookData.element.style.zIndex = 10 + index;
                    }
                } else console.warn(`Missing target slot data for index ${index}, title: "${bookData.title}"`);
            });
            console.log("AutoSort: Sorting complete.");
        } catch (error) { console.error("AutoSort: Error during sorting:", error); }
        finally { if (bookshelfObserver && currentBookshelfElement && document.body.contains(currentBookshelfElement)) setTimeout(() => bookshelfObserver.observe(currentBookshelfElement, { childList: true, subtree: true }), 50); } // Reconnect after a delay
    }

    // --- Setup observer for bookshelf content changes ---
    function setupBookshelfObserver(targetNode) {
        if (bookshelfObserver) { // Disconnect previous if exists
             console.log("AutoSort: Disconnecting old bookshelf observer.");
             bookshelfObserver.disconnect();
        }
        currentBookshelfElement = targetNode; // Update global reference
        console.log("AutoSort: Setting up observer on new bookshelf element:", currentBookshelfElement.id);

        bookshelfObserver = new MutationObserver((mutationsList, obs) => {
            let relevantChange = false;
            for (const mutation of mutationsList) {
                 if (mutation.type === 'childList') {
                      const hasRelevantNodes = (nodes) => Array.from(nodes).some(node =>
                          (node.nodeType === Node.ELEMENT_NODE && (node.id?.startsWith('book-card-') || node.id?.startsWith('shelf-')))
                      );
                      if (hasRelevantNodes(mutation.addedNodes) || hasRelevantNodes(mutation.removedNodes)) {
                          relevantChange = true; break;
                      }
                 }
            }
            if (relevantChange) {
                console.log("AutoSort: Relevant mutation detected inside bookshelf.");
                debouncedSort(); // Trigger debounced sort
            }
        });

        bookshelfObserver.observe(targetNode, { childList: true, subtree: true });
        console.log("AutoSort: Bookshelf observer is now active.");
        // Trigger initial sort for the newly found bookshelf
        console.log("AutoSort: Triggering initial sort for new bookshelf.");
        setTimeout(sortBooksNaturally, 250); // Short delay for initial sort
    }

    // --- Cleanup bookshelf observer ---
    function cleanupBookshelfObserver() {
        if (bookshelfObserver) {
            console.log("AutoSort: Cleaning up bookshelf observer.");
            bookshelfObserver.disconnect();
            bookshelfObserver = null;
        }
        currentBookshelfElement = null; // Clear reference
    }

    // --- SPA Navigation Observer ---
    // Observe a stable parent element for view changes
    function initializeAppObserver() {
        const appContainer = document.getElementById('app-content') || document.body; // Target #app-content or fallback to body
        console.log("AutoSort: Initializing App Observer on:", appContainer.id || 'body');

        const appObserver = new MutationObserver((mutationsList, obs) => {
            // Check if bookshelf exists *now*
            const bookshelfNow = document.getElementById('bookshelf');

            if (bookshelfNow) {
                // Bookshelf view is present or was just added
                if (bookshelfNow !== currentBookshelfElement) {
                    // It's a new or different bookshelf element
                    console.log("AutoSort: Detected new/different bookshelf element via App Observer.");
                    setupBookshelfObserver(bookshelfNow); // Setup observer for it
                }
                // else: it's the same bookshelf, bookshelfObserver handles internal changes
            } else {
                // Bookshelf view is not present (or was just removed)
                if (currentBookshelfElement) {
                    // We previously had a bookshelf, but now it's gone
                    console.log("AutoSort: Detected bookshelf element removed via App Observer.");
                    cleanupBookshelfObserver(); // Disconnect and clear references
                }
            }
        });

        appObserver.observe(appContainer, { childList: true, subtree: true }); // Watch for elements being added/removed within the app container

        // Initial check in case the script loads after bookshelf is already there
        const initialBookshelf = document.getElementById('bookshelf');
        if (initialBookshelf) {
             console.log("AutoSort: Bookshelf already present on initial check.");
             setupBookshelfObserver(initialBookshelf);
        } else {
             console.log("AutoSort: Bookshelf not present on initial check.");
        }
    }

    // --- Start the process ---
    // Wait a moment for the initial SPA load before setting up the main app observer
    setTimeout(initializeAppObserver, 1000);

})();
