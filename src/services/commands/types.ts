export enum CommandOptionType {
    SUB_COMMAND = 1,
    SUB_COMMAND_GROUP = 2,
    STRING = 3,
    INTEGER = 4,
    BOOLEAN = 5,
    USER = 6,
    CHANNEL = 7,
    ROLE = 8,
    MENTIONABLE = 9,
    NUMBER = 10,
    ATTACHMENT = 11,
}

export interface CommandOption {
    type: CommandOptionType;
    name: string;
    description: string;
    required?: boolean;
    choices?: { name: string; value: string | number }[];
    options?: CommandOption[]; // For subcommands
}

export interface Command {
    name: string;
    description: string;
    options?: CommandOption[];
    // Return string to send that as a message, or void for side-effects
    execute: (args: Record<string, any>) => string | void | Promise<string | void>;
}

export interface ParsedCommand {
    name: string;
    args: Record<string, any>;
}
