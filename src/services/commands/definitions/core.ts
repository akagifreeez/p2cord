import { commandRegistry } from '../registry';
import { Command, CommandOptionType } from '../types';

const clearCommand: Command = {
    name: 'clear',
    description: 'Clears the chat history locally.',
    execute: (args) => {
        console.log('Clearing chat...', args);
        // This will be connected to the store later or trigger an event
        window.dispatchEvent(new CustomEvent('p2cord:clear-chat'));
    }
};

const helpCommand: Command = {
    name: 'help',
    description: 'Show available commands',
    execute: (args) => {
        const commands = commandRegistry.getAll();
        const helpText = commands.map(c => `/${c.name}: ${c.description}`).join('\n');

        window.dispatchEvent(new CustomEvent('p2cord:system-message', {
            detail: `*** Available Commands ***\n${helpText}`
        }));
    }
};

const echoCommand: Command = {
    name: 'echo',
    description: 'Echoes the message back.',
    options: [
        {
            name: 'message',
            description: 'The message to echo',
            type: CommandOptionType.STRING,
            required: true
        }
    ],
    execute: (args) => {
        const message = args['_all']?.join(' ') || '';
        window.dispatchEvent(new CustomEvent('p2cord:system-message', { detail: `Echo: ${message}` }));
    }
};

// Fun Commands (Ported from SlashCommandPicker)
const shrugCommand: Command = {
    name: 'shrug',
    description: '¯\\_(ツ)_/¯ を送信',
    execute: (args) => {
        const text = args['_all']?.join(' ') || '';
        return `¯\\_(ツ)_/¯ ${text}`.trim();
    }
};

const tableflipCommand: Command = {
    name: 'tableflip',
    description: '(╯°□°)╯︵ ┻━┻ を送信',
    execute: (args) => {
        const text = args['_all']?.join(' ') || '';
        return `(╯°□°)╯︵ ┻━┻ ${text}`.trim();
    }
};

const unflipCommand: Command = {
    name: 'unflip',
    description: '┬─┬ノ( º _ ºノ) を送信',
    execute: (args) => {
        const text = args['_all']?.join(' ') || '';
        return `┬─┬ノ( º _ ºノ) ${text}`.trim();
    }
};

const meCommand: Command = {
    name: 'me',
    description: 'アクション形式で送信',
    options: [{ name: 'action', type: CommandOptionType.STRING, description: 'Action text', required: true }],
    execute: (args) => {
        const text = args['_all']?.join(' ') || '';
        return `*${text}*`;
    }
};

const spoilerCommand: Command = {
    name: 'spoiler',
    description: 'スポイラーテキストを送信',
    options: [{ name: 'text', type: CommandOptionType.STRING, description: 'Content', required: true }],
    execute: (args) => {
        const text = args['_all']?.join(' ') || '';
        return `||${text}||`;
    }
};

const lennyCommand: Command = {
    name: 'lenny',
    description: '( ͡° ͜ʖ ͡°) を送信',
    execute: (args) => {
        const text = args['_all']?.join(' ') || '';
        return `( ͡° ͜ʖ ͡°) ${text}`.trim();
    }
};

export const registerCoreCommands = () => {
    commandRegistry.register(clearCommand);
    commandRegistry.register(helpCommand);
    commandRegistry.register(echoCommand);

    // Register Fun Commands
    commandRegistry.register(shrugCommand);
    commandRegistry.register(tableflipCommand);
    commandRegistry.register(unflipCommand);
    commandRegistry.register(meCommand);
    commandRegistry.register(spoilerCommand);
    commandRegistry.register(lennyCommand);
};
