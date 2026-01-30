import { Command } from './types.ts';

class CommandRegistry {
    private commands: Map<string, Command> = new Map();

    register(command: Command) {
        if (this.commands.has(command.name)) {
            console.warn(`Command ${command.name} is already registered. Overwriting.`);
        }
        this.commands.set(command.name, command);
    }

    get(name: string): Command | undefined {
        return this.commands.get(name);
    }

    getAll(): Command[] {
        return Array.from(this.commands.values());
    }

    getAllNames(): string[] {
        return Array.from(this.commands.keys());
    }
}

export const commandRegistry = new CommandRegistry();
