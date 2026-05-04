/**
 * Generates a Bitboard-based position string using JavaScript's BigInt.
 * Reads directly from the game's internal memory (BD and FORB arrays) for maximum speed.
 * 
 * Index mapping: index = row * 19 + col
 * 
 * @returns {string} Format: <Hex_Bitboard_X>,<Hex_Bitboard_O>,<Hex_Bitboard_Blocked>
 */
function getBitboardPosition() {
    const size = 19;
    let bbX = 0n;
    let bbO = 0n;
    let bbBlock = 0n;

    // Check if global memory is available
    if (typeof window.BD === 'undefined' || typeof window.FORB === 'undefined') {
        console.error("Game memory not found. Make sure you are in a match.");
        return "0,0,0";
    }

    // Process blocked cells (FORB is an array of [r, c])
    window.FORB.forEach(f => {
        const r = f[0];
        const c = f[1];
        const index = BigInt(r * size + c);
        bbBlock |= (1n << index);
    });

    // Process placed pieces (BD is a 2D array)
    for (let r = 0; r < size; r++) {
        if (!window.BD[r]) continue;
        for (let c = 0; c < size; c++) {
            const piece = window.BD[r][c];
            if (piece) {
                const index = BigInt(r * size + c);
                if (piece === 'X') {
                    bbX |= (1n << index);
                } else if (piece === 'O') {
                    bbO |= (1n << index);
                }
            }
        }
    }

    // Convert BigInts to base-16 (hexadecimal) strings for a compact payload
    return `${bbX.toString(16)},${bbO.toString(16)},${bbBlock.toString(16)}`;
}

/**
 * Parses a Bitboard position string back into a 2D array representation.
 * @param {string} bitboardStr - The comma-separated hex string (X,O,Blocked)
 * @returns {Array<Array<string>>} 19x19 2D array where each cell is 'X', 'O', '#', or '.'
 */
function parseBitboardToBoard(bitboardStr) {
    const parts = bitboardStr.split(',');
    if (parts.length !== 3) {
        console.error("Invalid bitboard string format. Expected 3 comma-separated hex strings.");
        return null;
    }

    const bbX = BigInt("0x" + parts[0]);
    const bbO = BigInt("0x" + parts[1]);
    const bbBlock = BigInt("0x" + parts[2]);

    const size = 19;
    let board = [];

    for (let r = 0; r < size; r++) {
        let row = [];
        for (let c = 0; c < size; c++) {
            const index = BigInt(r * size + c);
            const mask = 1n << index;

            if ((bbX & mask) !== 0n) row.push('X');
            else if ((bbO & mask) !== 0n) row.push('O');
            else if ((bbBlock & mask) !== 0n) row.push('#');
            else row.push('.');
        }
        board.push(row);
    }
    return board;
}

/**
 * Parses a Bitboard string and returns it as a formatted text grid (useful for verification).
 */
function getBoardTextFromBitboard(bitboardStr) {
    const board = parseBitboardToBoard(bitboardStr);
    if (!board) return null;
    return board.map(row => row.join(' ')).join('\n');
}

/**
 * Logs the board to the console for easy debugging.
 */
function debugBoard() {
    const bbPos = getBitboardPosition();
    const boardStr = getBoardTextFromBitboard(bbPos);
    if (boardStr) {
        console.log("Current Board State:\n" + boardStr);
        console.log("\nBitboard Payload: " + bbPos);
    }
}

/**
 * Executes a move directly via the game's WebSocket.
 * @param {number} x - The column index (0-18)
 * @param {number} y - The row index (0-18)
 * @returns {boolean} True if the payload was sent.
 */
function makeMove(x, y) {
    if (typeof window.socket === 'undefined' || !window.socket || !window.currentRoom) {
        console.error("Game socket or room not found.");
        return false;
    }

    window.socket.emit('make_move', { 
        roomCode: window.currentRoom, 
        row: y, 
        col: x 
    });

    console.log(`[Bot] Move sent to [${x}, ${y}]`);
    return true;
}

/**
 * Retrieves the opponent's unique User ID from the global game state.
 * @returns {string|null} The opponent's ID, or null if not in a game.
 */
function getOpponentId() {
    if (typeof window.casualPlayerIds === 'undefined' || typeof window.myP === 'undefined' || !window.myP) {
        return null;
    }
    const opponentPiece = window.myP === 'X' ? 'O' : 'X';
    return window.casualPlayerIds[opponentPiece];
}
