import React, { useState, useCallback, useMemo } from 'react';
import { commandRegistry } from '../services/commands/registry';
import { CommandParser } from '../services/commands/parser';
import { Command } from '../services/commands/types';

/**
 * Slash Command Picker
 * Shows commands starting with / (Built-in + Bot commands)
 */

// Bot Command (Discord Application Command)
export interface BotCommand {
    type: 'bot';
    id: string;
    version: string;
    application_id: string;
    name: string;
    description: string;
    options: any[]; // keeping loose for now to match Component prop
    guild_id?: string;
    integration_types?: number[]; // Added
    contexts?: number[]; // Added
}

export type AnyCommand = Command | BotCommand;

interface SlashCommandPickerProps {
    commands: AnyCommand[];
    isOpen: boolean;
    position: { top: number; left: number };
    selectedIndex: number;
    onSelect: (command: AnyCommand) => void;
    onClose: () => void;
}

export const SlashCommandPicker: React.FC<SlashCommandPickerProps> = ({
    commands,
    isOpen,
    position,
    selectedIndex,
    onSelect,
    onClose: _onClose,
}) => {
    if (!isOpen || commands.length === 0) return null;

    return (
        <div
            className="absolute z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden"
            style={{
                bottom: position.top,
                left: position.left,
                minWidth: '250px',
                maxWidth: '400px',
                maxHeight: '250px',
            }}
        >
            <div className="px-3 py-2 border-b border-gray-700 text-xs text-gray-400 font-bold uppercase">
                Commands
            </div>
            <div className="overflow-y-auto max-h-[200px] custom-scrollbar">
                {commands.map((cmd, index) => {
                    const isBot = 'type' in cmd && cmd.type === 'bot';
                    return (
                        <div
                            key={isBot ? `bot-${(cmd as BotCommand).id}` : `builtin-${cmd.name}`}
                            className={`px-3 py-2 cursor-pointer transition-colors ${index === selectedIndex
                                ? 'bg-blue-600 text-white'
                                : 'hover:bg-gray-800 text-gray-300'
                                }`}
                            onClick={() => onSelect(cmd)}
                        >
                            <div className="flex items-center gap-2">
                                {isBot && <span className="text-xs text-purple-400">🤖</span>}
                                <span className="font-mono text-cyan-400">/{cmd.name}</span>
                                {!isBot && cmd.options && cmd.options.length > 0 && (
                                    <span className="text-xs text-gray-500">
                                        {cmd.options.map(o => `[${o.name}]`).join(' ')}
                                    </span>
                                )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5 truncate">
                                {cmd.description}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="px-3 py-1.5 text-xs text-gray-500 border-t border-gray-700 bg-gray-900/50 flex justify-between">
                <span>↑↓ Select • Enter</span>
                <span>Esc Close</span>
            </div>
        </div>
    );
};

export function useSlashCommandPicker(botCommands: BotCommand[] = []) {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [triggerIndex, setTriggerIndex] = useState(-1);

    // Filter and merge commands
    const filteredCommands = useMemo(() => {
        if (!isOpen) return [];

        const lowerQuery = query.toLowerCase();

        // Match built-in commands
        const builtInMatches = commandRegistry.getAll().filter(cmd =>
            query.length === 0 || cmd.name.toLowerCase().startsWith(lowerQuery)
        );

        // Match bot commands
        const botMatches = botCommands.filter(cmd =>
            query.length === 0 || cmd.name.toLowerCase().startsWith(lowerQuery)
        );

        return [...builtInMatches, ...botMatches];
    }, [isOpen, query, botCommands]);

    // Input handling
    const handleInputChange = useCallback((
        value: string,
        cursorPosition: number
    ) => {
        // Find / at start or after space
        const beforeCursor = value.slice(0, cursorPosition);
        const slashMatch = beforeCursor.match(/(?:^|\s)\/(\w*)$/);

        if (slashMatch) {
            setIsOpen(true);
            const matchIndex = beforeCursor.lastIndexOf('/'); // Approximate, good enough for single line
            setTriggerIndex(matchIndex);
            setQuery(slashMatch[1]);
            setSelectedIndex(0);
        } else {
            setIsOpen(false);
            setQuery('');
            setTriggerIndex(-1);
        }
    }, []);

    // Keyboard handling
    const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean | { selected: AnyCommand } => {
        if (!isOpen) return false;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev < filteredCommands.length - 1 ? prev + 1 : 0
                );
                return true;

            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev > 0 ? prev - 1 : filteredCommands.length - 1
                );
                return true;

            case 'Enter':
            case 'Tab':
                if (filteredCommands[selectedIndex]) {
                    e.preventDefault();
                    return { selected: filteredCommands[selectedIndex] };
                }
                return false;

            case 'Escape':
                e.preventDefault();
                setIsOpen(false);
                return true;
        }
        return false;
    }, [isOpen, filteredCommands, selectedIndex]);

    // Command Execution
    const executeCommand = useCallback(async (
        fullInputValue: string,
        command: AnyCommand
    ): Promise<{ newValue: string; shouldSend: boolean; isBotCommand: boolean; botCommand?: BotCommand }> => {
        if (triggerIndex < 0) return { newValue: fullInputValue, shouldSend: false, isBotCommand: false };

        // Bot Command
        if ('type' in command && command.type === 'bot') {
            const before = fullInputValue.slice(0, triggerIndex);

            // Autocomplete the command name
            // Users will type arguments and hit Enter to execute (handled in ChannelChat)
            return {
                newValue: before + '/' + command.name + ' ',
                shouldSend: false,
                isBotCommand: false, // Don't trigger immediate execution
                botCommand: command,
            };
        }

        // Built-in Command with Parser
        // We need to parse everything AFTER the slash.
        // Assuming the input is currently `/cmd arg...`
        // But the user might have selected from picker before finishing typing.

        // Scenario A: User typed partial `/cle` and pressed Enter.
        // We should replace `/cle` with `/clear `?
        // Or if simple command, just run it?

        const cmd = command as Command;
        const before = fullInputValue.slice(0, triggerIndex);

        // For now, if picked from list, we just execute it with empty args if simple,
        // or we might want to auto-complete the name and wait for args.
        // But the current interaction model is "Action Commands" mostly.

        // Let's assume for now, selecting a command EXECUTES it if it has no required args?
        // Or maybe just auto-completes the name?
        // The original code executed it immediately.

        // Replicating original behavior:
        // Use regex to get args.

        // If we are auto-completing, we might not have args yet.
        // BUT if the user pressed Enter on the Picker, they are "selecting" the command.

        // If the command needs args (like /me action), usually we'd just autocomplete the Name.
        // But `CommandParser` parses a FULL string.

        // Temporary hybrid:
        // 1. If options required, just autocomplete name.
        // 2. If no options, Execute.

        const hasRequired = cmd.options?.some(o => o.required);

        if (hasRequired) {
            // Auto-complete name
            return {
                newValue: before + '/' + cmd.name + ' ',
                shouldSend: false,
                isBotCommand: false
            };
        }

        // Execute immediately
        // Note: We need to parse ANY existing args if they typed `/shrug foo`
        // Parser expects `/shrug foo`

        // Correct reconstruction:
        const constructedInput = '/' + cmd.name + fullInputValue.slice(triggerIndex + 1 + query.length);

        // Execute
        const argsParsed = CommandParser.parse(constructedInput);
        if (!argsParsed) {
            // Fallback
            return { newValue: fullInputValue, shouldSend: false, isBotCommand: false };
        }

        const result = await cmd.execute(argsParsed.args);

        if (typeof result === 'string') {
            return {
                newValue: before + result,
                shouldSend: true,
                isBotCommand: false
            };
        } else {
            // Void return (side effect), clear command input
            return {
                newValue: before,
                shouldSend: false,
                isBotCommand: false
            };
        }

    }, [triggerIndex, query]);

    const close = useCallback(() => {
        setIsOpen(false);
        setQuery('');
        setTriggerIndex(-1);
    }, []);

    return {
        isOpen,
        commands: filteredCommands,
        selectedIndex,
        position: { top: 40, left: 0 },
        handleInputChange,
        handleKeyDown,
        executeCommand,
        close,
        setSelectedIndex,
    };
}
