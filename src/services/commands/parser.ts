import { ParsedCommand } from './types';

export class CommandParser {
    static parse(input: string): ParsedCommand | null {
        if (!input.trim().startsWith('/')) {
            return null;
        }

        const trimmed = input.trim();
        // Split by space, but respect quotes
        // Regex: Match quoted strings OR non-whitespace sequences
        const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
        const tokens: string[] = [];
        let match;

        while ((match = regex.exec(trimmed)) !== null) {
            // match[0] is the full match (quoted or not)
            // match[1] is double quoted content
            // match[2] is single quoted content
            if (match[1] !== undefined) {
                tokens.push(match[1]);
            } else if (match[2] !== undefined) {
                tokens.push(match[2]);
            } else {
                tokens.push(match[0]);
            }
        }

        if (tokens.length === 0) {
            return null;
        }

        // tokens[0] is "/command"
        const commandName = tokens[0].substring(1).toLowerCase();
        const args: Record<string, any> = {};

        // Simple argument parsing for now:
        // 1. If arguments contain '=', treat as key=value
        // 2. Otherwise treat as positional 'argN'

        // This is a simplified parser. For full robust parsing matching the definitions,
        // we would need to look up the Command definition here.
        // For now, we pass raw tokens as _positional, and named flags as keys.

        const positional: string[] = [];

        for (let i = 1; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.startsWith('--')) {
                const parts = token.substring(2).split('=');
                const key = parts[0];
                const value = parts.length > 1 ? parts.slice(1).join('=') : true; // boolean flag
                args[key] = value;
            } else {
                positional.push(token);
            }
        }

        args['_all'] = positional;
        // Assign positional args to generic indices for now
        positional.forEach((val, idx) => {
            args[idx] = val;
        });

        return {
            name: commandName,
            args: args
        };
    }
}
