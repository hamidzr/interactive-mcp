import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fsPromises from 'fs/promises';
import { watch } from 'fs';
import os from 'os';
import crypto from 'crypto';
// Updated import to use @ alias
import { USER_INPUT_TIMEOUT_SECONDS } from '../../constants.js'; // Import the constant
import logger from '../../utils/logger.js';
// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Define cleanupResources outside the promise to be accessible in the final catch
async function cleanupResources(heartbeatPath, responsePath, optionsPath) {
  await Promise.allSettled([
    fsPromises.unlink(responsePath).catch(() => {}),
    fsPromises.unlink(heartbeatPath).catch(() => {}),
    fsPromises.unlink(optionsPath).catch(() => {}), // Cleanup options file
    // Potentially add cleanup for other session-related files if needed
  ]);
}
/**
 * Get the terminal command and arguments for spawning the UI
 *
 * This function implements a flexible terminal detection system that:
 * 1. First checks the $TERMINAL environment variable for user preference
 * 2. Provides special handling for popular terminals (Kitty, Alacritty, WezTerm, iTerm2)
 * 3. Falls back to platform-specific defaults
 * 4. On Linux, automatically detects available terminals in order of preference
 *
 * Supported terminals:
 * - Kitty: Uses --title and -- separator for clean command execution
 * - Alacritty: Uses --title and -e for command execution
 * - WezTerm: Uses start command with -- separator
 * - iTerm2: Uses AppleScript for window creation (macOS only)
 * - GNOME Terminal: Uses --title= syntax and -- separator
 * - Konsole: Uses --title and -e for command execution
 * - xterm: Uses -title and -e for command execution
 *
 * Environment variable usage:
 * Set $TERMINAL to your preferred terminal executable path:
 * export TERMINAL=/usr/local/bin/kitty
 * export TERMINAL=/Applications/Alacritty.app/Contents/MacOS/alacritty
 *
 * @param uiScriptPath Path to the UI script
 * @param sessionId Session ID for the UI
 * @param tempDir Temporary directory path
 * @returns Object with command and args, or null if no suitable terminal found
 */
function getTerminalCommand(uiScriptPath, sessionId, tempDir) {
  const platform = os.platform();
  const nodeCommand = `node "${uiScriptPath}" "${sessionId}" "${tempDir}"`;
  // Check for $TERMINAL environment variable first
  const terminalEnv = process.env.TERMINAL;
  if (terminalEnv) {
    const terminalName = path.basename(terminalEnv).toLowerCase();
    // Special handling for Kitty
    if (terminalName === 'kitty') {
      return {
        command: terminalEnv,
        args: [
          '--title',
          `Interactive MCP Input`,
          '--',
          'sh',
          '-c',
          nodeCommand,
        ],
      };
    }
    // Special handling for other known terminals
    if (terminalName === 'alacritty') {
      return {
        command: terminalEnv,
        args: [
          '--title',
          'Interactive MCP Input',
          '-e',
          'sh',
          '-c',
          nodeCommand,
        ],
      };
    }
    if (terminalName === 'wezterm') {
      return {
        command: terminalEnv,
        args: ['start', '--', 'sh', '-c', nodeCommand],
      };
    }
    if (terminalName === 'iterm2' || terminalName === 'iterm') {
      // iTerm2 doesn't have a direct command line interface like others
      // Fall back to AppleScript approach for iTerm2
      if (platform === 'darwin') {
        const escapedNodeCommand = nodeCommand
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        return {
          command: `osascript -e 'tell application "iTerm2" to create window with default profile command "${escapedNodeCommand}"'`,
          args: [],
          shell: true,
        };
      }
    }
    // Generic terminal support - try common patterns
    // Most terminals support -e for executing commands
    return {
      command: terminalEnv,
      args: ['-e', 'sh', '-c', nodeCommand],
    };
  }
  // Platform-specific fallbacks when $TERMINAL is not set
  if (platform === 'darwin') {
    // macOS - use Terminal.app via AppleScript
    const escapedNodeCommand = `exec ${nodeCommand}; exit 0`
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    return {
      command: `osascript -e 'tell application "Terminal" to activate' -e 'tell application "Terminal" to do script "${escapedNodeCommand}"'`,
      args: [],
      shell: true,
    };
  } else if (platform === 'linux') {
    // Linux - try common terminals in order of preference
    const terminals = [
      {
        cmd: 'kitty',
        args: [
          '--title',
          'Interactive MCP Input',
          '--',
          'sh',
          '-c',
          nodeCommand,
        ],
      },
      {
        cmd: 'alacritty',
        args: [
          '--title',
          'Interactive MCP Input',
          '-e',
          'sh',
          '-c',
          nodeCommand,
        ],
      },
      {
        cmd: 'gnome-terminal',
        args: ['--title=Interactive MCP Input', '--', 'sh', '-c', nodeCommand],
      },
      {
        cmd: 'konsole',
        args: [
          '--title',
          'Interactive MCP Input',
          '-e',
          'sh',
          '-c',
          nodeCommand,
        ],
      },
      {
        cmd: 'xterm',
        args: [
          '-title',
          'Interactive MCP Input',
          '-e',
          'sh',
          '-c',
          nodeCommand,
        ],
      },
    ];
    // Try to find an available terminal
    for (const terminal of terminals) {
      try {
        // Check if the terminal is available
        execSync(`which ${terminal.cmd}`, { stdio: 'ignore' });
        return {
          command: terminal.cmd,
          args: terminal.args,
        };
      } catch {
        // Terminal not found, try next one
        continue;
      }
    }
  } else if (platform === 'win32') {
    // Windows - use cmd or PowerShell
    return {
      command: 'cmd',
      args: ['/c', 'start', 'cmd', '/k', nodeCommand],
    };
  }
  return null;
}
/**
 * Display a command window with a prompt and return user input
 * @param projectName Name of the project requesting input (used for title)
 * @param promptMessage Message to display to the user
 * @param timeoutSeconds Timeout in seconds
 * @param showCountdown Whether to show a countdown timer
 * @param predefinedOptions Optional list of predefined options for quick selection
 * @returns User input or empty string if timeout
 */
export async function getCmdWindowInput(
  projectName,
  promptMessage,
  timeoutSeconds = USER_INPUT_TIMEOUT_SECONDS, // Use constant as default
  showCountdown = true,
  predefinedOptions,
) {
  // Create a temporary file for the detached process to write to
  const sessionId = crypto.randomBytes(8).toString('hex');
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `cmd-ui-response-${sessionId}.txt`);
  const heartbeatFilePath = path.join(
    tempDir,
    `cmd-ui-heartbeat-${sessionId}.txt`,
  );
  const optionsFilePath = path.join(
    tempDir,
    `cmd-ui-options-${sessionId}.json`,
  ); // New options file path
  return new Promise((resolve) => {
    // Wrap the async setup logic in an IIFE
    void (async () => {
      // Path to the UI script (will be in the same directory after compilation)
      const uiScriptPath = path.join(__dirname, 'ui.js');
      // Gather options
      const options = {
        projectName,
        prompt: promptMessage,
        timeout: timeoutSeconds,
        showCountdown,
        sessionId,
        outputFile: tempFilePath,
        heartbeatFile: heartbeatFilePath, // Pass heartbeat file path too
        predefinedOptions,
      };
      let ui;
      // Moved setup into try block
      try {
        // Write options to the file before spawning
        await fsPromises.writeFile(
          optionsFilePath,
          JSON.stringify(options),
          'utf8',
        );
        // Get terminal command using the new function
        const terminalCmd = getTerminalCommand(
          uiScriptPath,
          sessionId,
          tempDir,
        );
        if (!terminalCmd) {
          throw new Error(
            'No suitable terminal found. Please set $TERMINAL environment variable or install a supported terminal.',
          );
        }
        // Spawn the terminal with the UI
        ui = spawn(terminalCmd.command, terminalCmd.args, {
          stdio: ['ignore', 'ignore', 'ignore'],
          shell: terminalCmd.shell || false,
          detached: true,
          ...(os.platform() === 'win32' && { windowsHide: false }),
        });
        let watcher = null;
        let timeoutHandle = null;
        let heartbeatInterval = null;
        let heartbeatFileSeen = false; // Track if we've ever seen the heartbeat file
        const startTime = Date.now(); // Record start time for initial grace period
        // Define cleanupAndResolve inside the promise scope
        const cleanupAndResolve = async (response) => {
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          if (watcher) {
            watcher.close();
            watcher = null;
          }
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          // Pass optionsFilePath to cleanupResources
          await cleanupResources(
            heartbeatFilePath,
            tempFilePath,
            optionsFilePath,
          );
          resolve(response);
        };
        // Listen for process exit events - moved definition before IIFE start
        const handleExit = (code) => {
          // If the process exited with a non-zero code and watcher/timeout still exist
          if (code !== 0 && (watcher || timeoutHandle)) {
            void cleanupAndResolve('');
          }
        };
        const handleError = () => {
          if (watcher || timeoutHandle) {
            // Only cleanup if not already cleaned up
            void cleanupAndResolve('');
          }
        };
        ui.on('exit', handleExit);
        ui.on('error', handleError);
        // Unref the child process so the parent can exit independently
        ui.unref();
        // Create an empty temp file before watching for user response
        await fsPromises.writeFile(tempFilePath, '', 'utf8'); // Use renamed import
        // Wait briefly for the heartbeat file to potentially be created
        await new Promise((res) => setTimeout(res, 500));
        // Watch for content being written to the temp file
        watcher = watch(tempFilePath, (eventType) => {
          // Removed async
          if (eventType === 'change') {
            // Read the response and cleanup
            // Use an async IIFE inside the non-async callback
            void (async () => {
              try {
                const data = await fsPromises.readFile(tempFilePath, 'utf8'); // Use renamed import
                if (data) {
                  const response = data.trim();
                  void cleanupAndResolve(response); // Mark promise as intentionally ignored
                }
              } catch (readError) {
                logger.error('Error reading response file:', readError);
                void cleanupAndResolve(''); // Cleanup on read error
              }
            })();
          }
        });
        // Start heartbeat check interval
        heartbeatInterval = setInterval(() => {
          // Removed async
          // Use an async IIFE inside the non-async callback
          void (async () => {
            try {
              const stats = await fsPromises.stat(heartbeatFilePath); // Use renamed import
              const now = Date.now();
              // If file hasn't been modified in the last 3 seconds, assume dead
              if (now - stats.mtime.getTime() > 3000) {
                logger.info(
                  `Heartbeat file ${heartbeatFilePath} hasn't been updated recently. Process likely exited.`,
                );
                void cleanupAndResolve(''); // Mark promise as intentionally ignored
              } else {
                heartbeatFileSeen = true; // Mark that we've seen the file
              }
            } catch (err) {
              // Type err as unknown
              // Check if err is an error object with a code property
              if (err && typeof err === 'object' && 'code' in err) {
                const error = err; // Type assertion
                if (error.code === 'ENOENT') {
                  // File not found
                  if (heartbeatFileSeen) {
                    // File existed before but is now gone, assume dead
                    logger.info(
                      `Heartbeat file ${heartbeatFilePath} not found after being seen. Process likely exited.`,
                    );
                    void cleanupAndResolve(''); // Mark promise as intentionally ignored
                  } else if (Date.now() - startTime > 7000) {
                    // File never appeared and initial grace period (7s) passed, assume dead
                    logger.info(
                      `Heartbeat file ${heartbeatFilePath} never appeared. Process likely failed to start.`,
                    );
                    void cleanupAndResolve(''); // Mark promise as intentionally ignored
                  }
                  // Otherwise, file just hasn't appeared yet, wait longer
                } else {
                  // Removed check for !== 'ENOENT' as it's implied
                  // Log other errors and resolve
                  logger.error('Heartbeat check error:', error);
                  void cleanupAndResolve(''); // Resolve immediately on other errors? Marked promise as intentionally ignored
                }
              } else {
                // Handle cases where err is not an object with a code property
                logger.error('Unexpected heartbeat check error:', err);
                void cleanupAndResolve(''); // Mark promise as intentionally ignored
              }
            }
          })();
        }, 1500); // Check every 1.5 seconds
        // Timeout to stop watching if no response within limit
        timeoutHandle = setTimeout(
          () => {
            logger.info(
              `Input timeout reached after ${timeoutSeconds} seconds.`,
            ); // Added logger info
            void cleanupAndResolve(''); // Mark promise as intentionally ignored
          },
          timeoutSeconds * 1000 + 5000,
        ); // Add a bit more buffer
      } catch (setupError) {
        logger.error('Error during cmd-input setup:', setupError);
        // Ensure cleanup happens even if setup fails
        // Pass optionsFilePath to cleanupResources
        await cleanupResources(
          heartbeatFilePath,
          tempFilePath,
          optionsFilePath,
        );
        resolve(''); // Resolve with empty string after attempting cleanup
      }
    })(); // Execute the IIFE
  });
}
