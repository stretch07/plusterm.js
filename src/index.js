import {Terminal} from 'xterm';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function isPrintableKeyCode(keyCode) {
    return (
        keyCode === 32 ||
        (keyCode >= 48 && keyCode <= 90) ||
        (keyCode >= 96 && keyCode <= 111) ||
        (keyCode >= 186 && keyCode <= 222)
    );
}

export class Plusterm {
    constructor(element, prompt, cmds) {
        this.xterm = new Terminal();
        this.xterm.open(element);
        this.xterm.onKey(this._createOnKeyHandler())
        this.PROMPT = prompt;

        this.SystemCommands = [
            {
                id: "id",
                usage: "id command",
                description: "returns user identity",
                args: 0,
                async exec(term) {
                    term.writeln("uid=001(anonymous)");
                },
            },
            {
                id: "man",
                usage: "man command",
                description: "show manual pages for a command",
                args: 1,
                async exec(term, args) {
                    const command = this.SystemCommands.find((c) => c.id === args[0]);
                    if (!command) {
                        term.writeln(
                            `[error]: command "${args[0]}" not found`
                        );
                        return;
                    }
                    term.writeln("NAME");
                    term.writeln(`\t ${command.id} - ${command.description}`);
                    if (command.usage) {
                        term.writeln("\nSYNOPSIS");
                        term.writeln(`\t ${command.usage}`);
                    }
                },
            },
        ]
        if (cmds) {
            this.SystemCommands.push(...cmds)
        }
    }
    setPrompt(prompt) {
        this.prompt = prompt;

    }
    _handleBackspace(input) {
        const term = this.xterm
        if (input.length === 0) return input;

        if (term._core.buffer.x === 0 && term._core.buffer.y > 1) {
            // Move up
            term.write("\x1b[A");
            // Move to the end
            term.write("\x1b[" + term._core.buffer._cols + "G");
            term.write(" ");
        } else {
            term.write("\b \b");
        }
        return input.substring(0, input.length - 1);
    }

    _createOnKeyHandler() {
        const term = this.xterm
        // Track the user input
        let userInput = "";
        // Track command history
        let commandHistory = this.loadCommandHistory();
        let currentHistoryPosition = commandHistory.length;
        // Only one process at a time
        let currentProcessId = null;

        let that = this //this is certified jankencode
        function onProcessExit() {
            that.prompt(term);
            currentProcessId = null;
        }

        return async ({ key, domEvent: ev }) => {
            if (currentProcessId !== null) {
                return;
            }

            switch (ev.key) {
                case "ArrowUp":
                case "ArrowDown": {
                    if (commandHistory.length === 0) {
                        return;
                    }

                    if (ev.key === "ArrowDown") {
                        if (currentHistoryPosition === commandHistory.length) return;

                        currentHistoryPosition = Math.min(
                            commandHistory.length,
                            currentHistoryPosition + 1
                        );
                    } else {
                        currentHistoryPosition = Math.max(0, currentHistoryPosition - 1);
                    }

                    this._deleteCurrentInput(userInput);
                    if (currentHistoryPosition === commandHistory.length) {
                        userInput = "";
                    } else {
                        userInput = commandHistory[currentHistoryPosition];
                    }
                    term.write(userInput);
                    return;
                }

                case "c": {
                    if (ev.ctrlKey) {
                        this.prompt(term);
                        userInput = "";
                        currentHistoryPosition = commandHistory.length;
                        return;
                    }
                    break;
                }

                case "l": {
                    if (ev.ctrlKey) {
                        term.clear();
                        return;
                    }
                    break;
                }

                case "d": {
                    if (ev.ctrlKey) {
                        term.writeln('terminating session...');
                        await sleep(Infinity);
                        return;
                    }
                    break;
                }

                case "Backspace": {
                    userInput = this._handleBackspace(userInput);
                    return;
                }

                case "Enter": {
                    userInput = userInput.trim();
                    if (userInput.length === 0) {
                        userInput = "";
                        this.prompt(term);
                        return;
                    }

                    term.writeln("");

                    try {
                        currentProcessId = await this.exec(term, userInput, onProcessExit);
                    } catch (e) {
                        this.xterm.write(e.message);
                    }

                    this.pushCommandToHistory(commandHistory, userInput);
                    currentHistoryPosition = commandHistory.length;

                    userInput = "";
                    if (currentProcessId === null) {
                        this.prompt(term);
                    }
                    return;
                }
            }

            const hasModifier = ev.altKey || ev.ctrlKey || ev.metaKey;

            if (!hasModifier && isPrintableKeyCode(ev.keyCode)) {
                term.write(key);
                userInput += key;
            }
        };
    }
    _deleteCurrentInput(input) {
        let i = 0;
        while (i < input.length) {
            this.xterm.write("\b \b");
            i++;
        }
    }
    prompt() {
        this.xterm.write("\r\n" + this.PROMPT);
    }
    pushCommandToHistory(store, command) {
        // Avoid duplicates with last command
        if (store.length > 0 && store[store.length - 1] === command) {
            return;
        }
        store.push(command);
        if (store.length > 100) {
            store.shift();
        }
        setTimeout(() => localStorage.setItem("history", JSON.stringify(store)), 0);
    }

    loadCommandHistory() {
        const data = localStorage.getItem("history");
        if (!data) {
            return [];
        }
        try {
            return JSON.parse(data);
        } catch (e) {
            console.error("Failed to parse command history", e);
            return [];
        }
    }
    async exec(userInput, onProcessExit) {
        const term = this.xterm
        // Handle arguments check here to avoid duplication
        const [input, ...args] = userInput.split(/\s+/);
        const command = this.SystemCommands.find((c) => c.id === input);
        if (!command) {
            throw new Error(
                'Command not found. Type "help" to list available commands'
            );
        }

        if (command.args === 0 && args.length > 0) {
            throw new Error(`${command.id} does not accept arguments`);
        }

        if (
            (command.args === -1 && args.length === 0) ||
            (command.args !== -1 && command.args !== args.length)
        ) {
            throw new Error(
                `not enough arguments\r\n usage: ${command.usage}`
            );
        }

        await command.exec(term, args, onProcessExit);
        if (command.process) {
            return command.id;
        }

        return null;
    }
}