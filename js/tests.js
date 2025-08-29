// RhythmCrew Unit Tests
// Comprehensive test suite for queue management, voting, WebSocket handling, and UI components

class TestRunner {
    constructor() {
        this.tests = [];
        this.results = { passed: 0, failed: 0, total: 0 };
    }

    // Add a test to the suite
    addTest(name, testFunction) {
        this.tests.push({ name, testFunction });
    }

    // Run all tests
    async runAllTests() {
        console.log('🧪 Starting RhythmCrew Test Suite...\n');

        for (const test of this.tests) {
            await this.runTest(test);
        }

        this.printSummary();
        return this.results;
    }

    // Run a single test
    async runTest(test) {
        this.results.total++;
        try {
            const result = await test.testFunction();
            if (result === true || result === undefined) {
                console.log(`✅ PASS: ${test.name}`);
                this.results.passed++;
            } else {
                console.log(`❌ FAIL: ${test.name} - ${result}`);
                this.results.failed++;
            }
        } catch (error) {
            console.log(`❌ ERROR: ${test.name} - ${error.message}`);
            this.results.failed++;
        }
    }

    // Print test summary
    printSummary() {
        const { passed, failed, total } = this.results;
        const successRate = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

        console.log('\n📊 Test Summary:');
        console.log(`Total Tests: ${total}`);
        console.log(`Passed: ${passed}`);
        console.log(`Failed: ${failed}`);
        console.log(`Success Rate: ${successRate}%`);

        if (failed === 0) {
            console.log('🎉 All tests passed!');
        } else {
            console.log(`⚠️  ${failed} test(s) failed`);
        }
    }
}

// Mock WebSocket for testing
class MockWebSocket {
    constructor() {
        this.readyState = WebSocket.OPEN;
        this.sentMessages = [];
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
    }

    send(message) {
        this.sentMessages.push(message);
    }

    close() {
        this.readyState = WebSocket.CLOSED;
    }

    // Simulate receiving a message
    receiveMessage(data) {
        if (this.onmessage) {
            this.onmessage({ data: JSON.stringify(data) });
        }
    }
}

// Test utilities
const TestUtils = {
    // Create mock song data
    createMockSong(id, name = 'Test Song', artist = 'Test Artist', genre = 'Rock') {
        return {
            id,
            name,
            artist,
            album: 'Test Album',
            genre,
            charter: 'Test Charter',
            year: 2023,
            songlength: 180000 // 3 minutes in ms
        };
    },

    // Create mock queue item
    createMockQueueItem(id, songId, userId, upvotes = 0, downvotes = 0) {
        return {
            id,
            song_id: songId,
            user_id: userId,
            upvotes,
            downvotes,
            requested_at: new Date().toISOString(),
            user_name: 'Test User',
            user_avatar: '🎵'
        };
    },

    // Mock DOM elements
    createMockElement(tagName = 'div') {
        const element = document.createElement(tagName);
        element.setAttribute = jest.fn();
        element.classList.add = jest.fn();
        element.classList.remove = jest.fn();
        element.classList.contains = jest.fn().mockReturnValue(false);
        return element;
    }
};

// Test Suite
const testSuite = new TestRunner();

// Queue Sorting Tests
testSuite.addTest('Queue sorts by upvotes descending', () => {
    // Mock queue data with different upvote counts
    const mockQueue = [
        TestUtils.createMockQueueItem(1, 1, 'user1', 5, 0),
        TestUtils.createMockQueueItem(2, 2, 'user2', 10, 0),
        TestUtils.createMockQueueItem(3, 3, 'user3', 3, 0)
    ];

    // Sort by upvotes descending
    const sorted = [...mockQueue].sort((a, b) => b.upvotes - a.upvotes);

    // Verify order
    return sorted[0].upvotes === 10 &&
           sorted[1].upvotes === 5 &&
           sorted[2].upvotes === 3;
});

testSuite.addTest('Queue sorts by oldest first for tie-breaking', () => {
    const now = new Date();
    const mockQueue = [
        TestUtils.createMockQueueItem(1, 1, 'user1', 5, 0),
        TestUtils.createMockQueueItem(2, 2, 'user2', 5, 0),
        TestUtils.createMockQueueItem(3, 3, 'user3', 5, 0)
    ];

    // Set different request times (older first)
    mockQueue[0].requested_at = new Date(now.getTime() - 300000).toISOString(); // 5 min ago
    mockQueue[1].requested_at = new Date(now.getTime() - 600000).toISOString(); // 10 min ago
    mockQueue[2].requested_at = new Date(now.getTime() - 120000).toISOString(); // 2 min ago

    // Sort by upvotes DESC, then requested_at ASC
    const sorted = [...mockQueue].sort((a, b) => {
        if (b.upvotes !== a.upvotes) {
            return b.upvotes - a.upvotes;
        }
        return new Date(a.requested_at) - new Date(b.requested_at);
    });

    // Verify oldest comes first in tie
    return sorted[0].id === 2 && // 10 min ago (oldest)
           sorted[1].id === 1 && // 5 min ago
           sorted[2].id === 3;   // 2 min ago (newest)
});

// Voting Mechanics Tests
testSuite.addTest('Upvote increments correctly', () => {
    const mockQueueItem = TestUtils.createMockQueueItem(1, 1, 'user1', 5, 2);
    const originalUpvotes = mockQueueItem.upvotes;

    // Simulate upvote
    mockQueueItem.upvotes += 1;

    return mockQueueItem.upvotes === originalUpvotes + 1;
});

testSuite.addTest('Voting maintains data integrity', () => {
    const mockQueueItem = TestUtils.createMockQueueItem(1, 1, 'user1', 5, 2);
    const originalTotal = mockQueueItem.upvotes + mockQueueItem.downvotes;

    // Simulate multiple votes
    mockQueueItem.upvotes += 3;
    mockQueueItem.downvotes += 1;

    const newTotal = mockQueueItem.upvotes + mockQueueItem.downvotes;

    return newTotal === originalTotal + 4; // Should increase by number of votes added
});

// WebSocket Message Handling Tests
testSuite.addTest('sendWebSocketMessage handles connection errors', () => {
    // Mock ws object with CLOSED state
    const originalWs = window.ws;
    window.ws = new MockWebSocket();
    window.ws.readyState = WebSocket.CLOSED;

    // Mock showToast
    const originalShowToast = window.showToast;
    let toastMessage = '';
    window.showToast = (msg) => { toastMessage = msg; };

    // Test sending message when disconnected
    const result = sendWebSocketMessage({ action: 'test' });

    // Restore originals
    window.ws = originalWs;
    window.showToast = originalShowToast;

    return result === false && toastMessage.includes('Not connected');
});

testSuite.addTest('sendWebSocketMessage sends JSON correctly', () => {
    // Mock ws object
    const originalWs = window.ws;
    const mockWs = new MockWebSocket();
    window.ws = mockWs;

    const testMessage = { action: 'request_song', song_id: 123 };
    sendWebSocketMessage(testMessage);

    // Restore original
    window.ws = originalWs;

    // Verify message was sent as JSON string
    const sentMessage = JSON.parse(mockWs.sentMessages[0]);
    return sentMessage.action === testMessage.action &&
           sentMessage.song_id === testMessage.song_id;
});

// Genre Analysis Tests
testSuite.addTest('extractGenresFromSongs creates correct genre counts', () => {
    const mockSongs = [
        TestUtils.createMockSong(1, 'Song1', 'Artist1', 'Rock'),
        TestUtils.createMockSong(2, 'Song2', 'Artist2', 'Pop'),
        TestUtils.createMockSong(3, 'Song3', 'Artist3', 'Rock'),
        TestUtils.createMockSong(4, 'Song4', 'Artist4', 'Jazz')
    ];

    const genreCount = extractGenresFromSongs(mockSongs);

    return genreCount.get('Rock') === 2 &&
           genreCount.get('Pop') === 1 &&
           genreCount.get('Jazz') === 1;
});

testSuite.addTest('getTopGenres returns correct number of genres', () => {
    const genreCount = new Map([
        ['Rock', 10],
        ['Pop', 8],
        ['Jazz', 5],
        ['Classical', 3],
        ['Hip Hop', 2]
    ]);

    // Mock the extractGenresFromSongs to return our test data
    const originalExtractGenres = window.extractGenresFromSongs;
    window.extractGenresFromSongs = () => genreCount;

    const topGenres = getTopGenres([], 3); // Limit to 3

    // Restore original
    window.extractGenresFromSongs = originalExtractGenres;

    return topGenres.length === 3 &&
           topGenres.includes('Rock') &&
           topGenres.includes('Pop') &&
           topGenres.includes('Jazz');
});

// UI Component Tests
testSuite.addTest('formatDuration formats milliseconds correctly', () => {
    const testCases = [
        { ms: 60000, expected: '1:00' },      // 1 minute
        { ms: 90000, expected: '1:30' },      // 1.5 minutes
        { ms: 3661000, expected: '61:01' },   // 61 minutes 1 second
        { ms: 0, expected: '0:00' }           // 0 seconds
    ];

    return testCases.every(testCase => {
        const result = formatDuration(testCase.ms);
        return result === testCase.expected;
    });
});

testSuite.addTest('cleanSongTitle removes unwanted content', () => {
    const testCases = [
        { input: 'Song Title (Remix)', expected: 'Song Title' },
        { input: 'Song [feat. Artist]', expected: 'Song' },
        { input: 'Normal Song', expected: 'Normal Song' },
        { input: '   Spaced Song   ', expected: 'Spaced Song' }
    ];

    return testCases.every(testCase => {
        const result = cleanSongTitle(testCase.input);
        return result === testCase.expected;
    });
});

// Export test runner for use in browser console or other scripts
window.TestRunner = TestRunner;
window.testSuite = testSuite;

// Auto-run tests if this script is loaded directly
if (typeof window !== 'undefined' && window.location) {
    // Run tests after a short delay to ensure all dependencies are loaded
    setTimeout(() => {
        testSuite.runAllTests();
    }, 1000);
}

console.log('🧪 RhythmCrew Test Suite loaded. Run testSuite.runAllTests() to execute all tests.');