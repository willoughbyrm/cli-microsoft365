import type * as Chalk from 'chalk';
import type * as Configstore from 'configstore';
import * as fs from 'fs';
import type { Inquirer } from 'inquirer';
import type * as JMESPath from 'jmespath';
import type * as Markshell from 'markshell';
import * as minimist from 'minimist';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '.';
import Command, { CommandError } from '../Command';
import config from '../config';
import { settingsNames } from '../settingsNames';
import Utils from '../Utils';
import { CommandInfo } from './CommandInfo';
import { CommandOptionInfo } from './CommandOptionInfo';
const packageJSON = require('../../package.json');

export interface CommandOutput {
  stdout: string;
  stderr: string;
}

export class Cli {
  public commands: CommandInfo[] = [];
  /**
   * Command to execute
   */
  private commandToExecute: CommandInfo | undefined;
  /**
   * Name of the command specified through args
   */
  public currentCommandName: string | undefined;
  private optionsFromArgs: { options: minimist.ParsedArgs } | undefined;
  private commandsFolder: string = '';
  private static instance: Cli;

  private _config: Configstore | undefined;
  public get config(): Configstore {
    if (!this._config) {
      const configStore: typeof Configstore = require('configstore');
      this._config = new configStore(config.configstoreName);
    }

    return this._config;
  }

  public getSettingWithDefaultValue<TValue>(settingName: string, defaultValue: TValue): TValue {
    const configuredValue: TValue | undefined = this.config.get(settingName);
    if (typeof configuredValue === 'undefined') {
      return defaultValue;
    }
    else {
      return configuredValue;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {
  }

  public static getInstance(): Cli {
    if (!Cli.instance) {
      Cli.instance = new Cli();
    }

    return Cli.instance;
  }

  public async execute(commandsFolder: string, rawArgs: string[]): Promise<void> {
    this.commandsFolder = commandsFolder;

    // check if help for a specific command has been requested using the
    // 'm365 help xyz' format. If so, remove 'help' from the array of words
    // to use lazy loading commands but keep track of the fact that help should
    // be displayed
    let showHelp: boolean = false;
    if (rawArgs.length > 0 && rawArgs[0] === 'help') {
      showHelp = true;
      rawArgs.shift();
    }

    // parse args to see if a command has been specified and can be loaded
    // rather than loading all commands
    const parsedArgs: minimist.ParsedArgs = minimist(rawArgs);
    
    // load commands
    this.loadCommandFromArgs(parsedArgs._);

    if (this.currentCommandName) {
      for (let i = 0; i < this.commands.length; i++) {
        const command: CommandInfo = this.commands[i];
        if (command.name === this.currentCommandName ||
          (command.aliases &&
            command.aliases.indexOf(this.currentCommandName) > -1)) {
          this.commandToExecute = command;
          break;
        }
      }
    }

    if (this.commandToExecute) {
      // we have found a command to execute. Parse args again taking into
      // account short and long options, option types and whether the command
      // supports known and unknown options or not
      this.optionsFromArgs = {
        options: this.getCommandOptionsFromArgs(rawArgs, this.commandToExecute)
      };
    }
    else {
      this.optionsFromArgs = {
        options: parsedArgs
      };
    }

    // show help if no match found, help explicitly requested or
    // no command specified
    if (!this.commandToExecute ||
      showHelp ||
      parsedArgs.h ||
      parsedArgs.help) {
      this.printHelp();
      return Promise.resolve();
    }

    // if the command doesn't allow unknown options, check if all specified
    // options match command options
    if (!this.commandToExecute.command.allowUnknownOptions()) {
      for (const optionFromArgs in this.optionsFromArgs.options) {
        if (optionFromArgs === '_') {
          // ignore catch-all option
          continue;
        }

        let matches: boolean = false;

        for (let i = 0; i < this.commandToExecute.options.length; i++) {
          const option: CommandOptionInfo = this.commandToExecute.options[i];
          if (optionFromArgs === option.long ||
            optionFromArgs === option.short) {
            matches = true;
            break;
          }
        }

        if (!matches) {
          return this.closeWithError(`Invalid option: '${optionFromArgs}'${os.EOL}`, true);
        }
      }
    }

    // validate options
    // validate required options
    for (let i = 0; i < this.commandToExecute.options.length; i++) {
      if (this.commandToExecute.options[i].required &&
        typeof this.optionsFromArgs.options[this.commandToExecute.options[i].name] === 'undefined') {
        return this.closeWithError(`Required option ${this.commandToExecute.options[i].name} not specified`, true);
      }
    }

    const optionsWithoutShorts = Cli.removeShortOptions(this.optionsFromArgs);
    try {
      // replace values staring with @ with file contents
      Cli.loadOptionValuesFromFiles(optionsWithoutShorts);
    }
    catch (e) {
      return this.closeWithError(e);
    }


    try {
      // process options before passing them on to validation stage
      await this.commandToExecute.command.processOptions(optionsWithoutShorts.options);
    }
    catch (e) {
      return this.closeWithError(e.message, false);
    }

    const validationResult: boolean | string = this.commandToExecute.command.validate(optionsWithoutShorts);
    if (typeof validationResult === 'string') {
      return this.closeWithError(validationResult, true);
    }

    // if output not specified, set the configured output value (if any)
    if (optionsWithoutShorts.options.output === undefined) {
      optionsWithoutShorts.options.output = this.getSettingWithDefaultValue<string | undefined>(settingsNames.output, undefined);
    }

    return Cli
      .executeCommand(this.commandToExecute.command, optionsWithoutShorts)
      .then(_ => process.exit(0), err => this.closeWithError(err));
  }

  public static executeCommand(command: Command, args: { options: minimist.ParsedArgs }): Promise<void> {
    return new Promise<void>((resolve: () => void, reject: (error: any) => void): void => {
      const logger: Logger = {
        log: (message: any): void => {
          const output: any = Cli.formatOutput(message, args.options);
          Cli.log(output);
        },
        logRaw: (message: any): void => Cli.log(message),
        logToStderr: (message: any): void => Cli.error(message)
      };

      if (args.options.debug) {
        logger.logToStderr(`Executing command ${command.name} with options ${JSON.stringify(args)}`);
      }

      // store the current command name, if any and set the name to the name of
      // the command to execute
      const cli = Cli.getInstance();
      const parentCommandName: string | undefined = cli.currentCommandName;
      cli.currentCommandName = command.getCommandName();

      command.action(logger, args as any, (err: any): void => {
        // restore the original command name
        cli.currentCommandName = parentCommandName;

        if (err) {
          return reject(err);
        }

        if (args.options.debug || args.options.verbose) {
          const chalk: typeof Chalk = require('chalk');
          logger.logToStderr(chalk.green('DONE'));
        }

        resolve();
      });
    });
  }

  public static executeCommandWithOutput(command: Command, args: { options: minimist.ParsedArgs }): Promise<CommandOutput> {
    return new Promise((resolve: (result: CommandOutput) => void, reject: (error: any) => void): void => {
      const log: string[] = [];
      const logErr: string[] = [];
      const logger: Logger = {
        log: (message: any): void => {
          log.push(Cli.formatOutput(message, args.options));
        },
        logRaw: (message: any): void => {
          log.push(Cli.formatOutput(message, args.options));
        },
        logToStderr: (message: any): void => {
          logErr.push(message);
        }
      };

      if (args.options.debug) {
        Cli.log(`Executing command ${command.name} with options ${JSON.stringify(args)}`);
      }

      // store the current command name, if any and set the name to the name of
      // the command to execute
      const cli = Cli.getInstance();
      const parentCommandName: string | undefined = cli.currentCommandName;
      cli.currentCommandName = command.getCommandName();

      command.action(logger, args as any, (err: any): void => {
        // restore the original command name
        cli.currentCommandName = parentCommandName;

        if (err) {
          return reject({
            error: err,
            stderr: logErr.join(os.EOL)
          });
        }

        resolve({
          stdout: log.join(os.EOL),
          stderr: logErr.join(os.EOL)
        });
      });
    });
  }

  public loadAllCommands(): void {
    const files: string[] = Cli.readdirR(this.commandsFolder) as string[];

    files.forEach(file => {
      if (file.indexOf(`${path.sep}commands${path.sep}`) > -1 &&
        file.endsWith('.js') &&
        !file.endsWith('.spec.js')) {
        try {
          const command: any = require(file);
          if (command instanceof Command) {
            this.loadCommand(command);
          }
        }
        catch (e) {
          this.closeWithError(e);
        }
      }
    });
  }

  /**
   * Loads command files into CLI based on the specified arguments.
   * 
   * @param commandNameWords Array of words specified as args
   */
  public loadCommandFromArgs(commandNameWords: string[]): void {
    this.currentCommandName = commandNameWords.join(' ');

    if (commandNameWords.length === 0) {
      this.loadAllCommands();
      return;
    }

    const isCompletionCommand: boolean = commandNameWords.indexOf('completion') > -1;
    if (isCompletionCommand) {
      this.loadAllCommands();
      return;
    }

    let commandFilePath = '';
    if (commandNameWords.length === 1) {
      commandFilePath = path.join(this.commandsFolder, 'commands', `${commandNameWords[0]}.js`);
    }
    else {
      if (commandNameWords.length === 2) {
        commandFilePath = path.join(this.commandsFolder, commandNameWords[0], 'commands', `${commandNameWords.join('-')}.js`);
      }
      else {
        commandFilePath = path.join(this.commandsFolder, commandNameWords[0], 'commands', commandNameWords[1], commandNameWords.slice(1).join('-') + '.js');
      }
    }

    this.loadCommandFromFile(commandFilePath);
  }

  /**
   * Loads command from the specified file into CLI. If can't find the file
   * or the file doesn't contain a command, loads all available commands.
   * 
   * @param commandFilePath File path of the file with command to load
   */
  private loadCommandFromFile(commandFilePath: string): void {
    if (!fs.existsSync(commandFilePath)) {
      this.loadAllCommands();
      return;
    }

    try {
      const command: any = require(commandFilePath);
      if (command instanceof Command) {
        this.loadCommand(command);
      }
      else {
        this.loadAllCommands();
      }
    }
    catch {
      this.loadAllCommands();
    }
  }

  private static readdirR(dir: string): string | string[] {
    return fs.statSync(dir).isDirectory()
      ? Array.prototype.concat(...fs.readdirSync(dir).map(f => Cli.readdirR(path.join(dir, f))))
      : dir;
  }

  private loadCommand(command: Command): void {
    this.commands.push({
      aliases: command.alias(),
      name: command.name,
      command: command,
      options: this.getCommandOptions(command),
      defaultProperties: command.defaultProperties()
    });
  }

  private getCommandOptions(command: Command): CommandOptionInfo[] {
    const options: CommandOptionInfo[] = [];

    command.options().forEach(option => {
      const required: boolean = option.option.indexOf('<') > -1;
      const optionArgs: string[] = option.option.split(/[ ,|]+/);
      let short: string | undefined;
      let long: string | undefined;
      let name: string = '';
      optionArgs.forEach(o => {
        if (o.startsWith('--')) {
          long = o.replace('--', '');
          name = long;
        }
        else if (o.startsWith('-')) {
          short = o.replace('-', '');
          name = short;
        }
      });

      options.push({
        autocomplete: option.autocomplete,
        long: long,
        name: name,
        required: required,
        short: short
      });
    });

    return options;
  }

  private getCommandOptionsFromArgs(args: string[], commandInfo: CommandInfo | undefined): minimist.ParsedArgs {
    const minimistOptions: minimist.Opts = {
      alias: {}
    };

    if (commandInfo) {
      const commandTypes = commandInfo.command.types();
      if (commandTypes) {
        minimistOptions.string = commandTypes.string;
        minimistOptions.boolean = commandTypes.boolean;
      }
      minimistOptions.alias = {};
      commandInfo.options.forEach(option => {
        if (option.short && option.long) {
          (minimistOptions.alias as any)[option.short] = option.long;
        }
      });
    }

    return minimist(args, minimistOptions);
  }

  private static formatOutput(logStatement: any, options: any): any {
    if (logStatement instanceof Date) {
      return logStatement.toString();
    }

    let logStatementType: string = typeof logStatement;

    if (logStatementType === 'undefined') {
      return logStatement;
    }

    // we need to get the list of object's properties to see if the specified
    // JMESPath query (if any) filters object's properties or not. We need to
    // know this in order to decide if we should use default command's
    // properties or custom ones from JMESPath
    const originalObject: any = Array.isArray(logStatement) ? Cli.getFirstNonUndefinedArrayItem(logStatement) : logStatement;
    const originalProperties: string[] = originalObject ? Object.getOwnPropertyNames(originalObject) : [];

    if (options.query &&
      !options.help) {
      const jmespath: typeof JMESPath = require('jmespath');
      logStatement = jmespath.search(logStatement, options.query);
      // we need to update the statement type in case the JMESPath query
      // returns an object of different shape than the original message to log
      // #2095
      logStatementType = typeof logStatement;
    }

    if (options.output === 'json') {
      return JSON.stringify(logStatement, null, 2);
    }

    if (logStatement instanceof CommandError) {
      const chalk: typeof Chalk = require('chalk');
      return chalk.red(`Error: ${logStatement.message}`);
    }

    let arrayType: string = '';
    if (!Array.isArray(logStatement)) {
      logStatement = [logStatement];
      arrayType = logStatementType;
    }
    else {
      for (let i: number = 0; i < logStatement.length; i++) {
        if (Array.isArray(logStatement[i])) {
          arrayType = 'array';
          break;
        }

        const t: string = typeof logStatement[i];
        if (t !== 'undefined') {
          arrayType = t;
          break;
        }
      }
    }

    if (arrayType !== 'object') {
      return logStatement.join(os.EOL);
    }

    // if output type has not been set or set to 'text', process the retrieved
    // data so that returned objects contain only default properties specified
    // on the current command. If there is no current command or the
    // command doesn't specify default properties, return original data
    if (!options.output || options.output === 'text') {
      const cli: Cli = Cli.getInstance();
      const currentCommand: CommandInfo | undefined = cli.commandToExecute;

      if (arrayType === 'object' &&
        currentCommand && currentCommand.defaultProperties) {
        // the log statement contains the same properties as the original object
        // so it can be filtered following the default properties specified on
        // the command
        if (JSON.stringify(originalProperties) === JSON.stringify(Object.getOwnPropertyNames(logStatement[0]))) {
          // in some cases we return properties wrapped in `value` array
          // returned by the API. We'll remove it in the future, but for now
          // we'll use a workaround to drop the `value` array here
          if (logStatement[0].value &&
            Array.isArray(logStatement[0].value)) {
            logStatement = logStatement[0].value;
          }

          logStatement = logStatement.map((s: any) =>
            Utils.filterObject(s, currentCommand.defaultProperties as string[]));
        }
      }
    }

    // display object as a list of key-value pairs
    if (logStatement.length === 1) {
      const obj: any = logStatement[0];
      const propertyNames: string[] = [];
      Object.getOwnPropertyNames(obj).forEach(p => {
        propertyNames.push(p);
      });

      let longestPropertyLength: number = 0;
      propertyNames.forEach(p => {
        if (p.length > longestPropertyLength) {
          longestPropertyLength = p.length;
        }
      });

      const output: string[] = [];
      propertyNames.sort().forEach(p => {
        output.push(`${p.length < longestPropertyLength ? p + new Array(longestPropertyLength - p.length + 1).join(' ') : p}: ${Array.isArray(obj[p]) || typeof obj[p] === 'object' ? JSON.stringify(obj[p]) : obj[p]}`);
      });

      return output.join('\n') + '\n';
    }
    // display object as a table where each property is a column
    else {
      const Table = require('easy-table');
      const t = new Table();
      logStatement.forEach((r: any) => {
        if (typeof r !== 'object') {
          return;
        }

        Object.getOwnPropertyNames(r).forEach(p => {
          t.cell(p, r[p]);
        });
        t.newRow();
      });

      return t.toString();
    }
  }

  private static getFirstNonUndefinedArrayItem(arr: any[]): any {
    for (let i: number = 0; i < arr.length; i++) {
      const a: any = arr[i];
      if (typeof a !== 'undefined') {
        return a;
      }
    }

    return undefined;
  }

  private printHelp(exitCode: number = 0): void {
    if (this.commandToExecute) {
      this.printCommandHelp();
    }
    else {
      Cli.log();
      Cli.log(`CLI for Microsoft 365 v${packageJSON.version}`);
      Cli.log(`${packageJSON.description}`);
      Cli.log();

      this.printAvailableCommands();
    }

    process.exit(exitCode);
  }

  private printCommandHelp(): void {
    let helpFilePath = '';
    let commandNameWords: string[] = [];
    if (this.commandToExecute) {
      commandNameWords = (this.commandToExecute.name).split(' ');
    }
    const pathChunks: string[] = [this.commandsFolder, '..', '..', 'docs', 'docs', 'cmd'];

    if (commandNameWords.length === 1) {
      pathChunks.push(`${commandNameWords[0]}.md`);
    }
    else {
      if (commandNameWords.length === 2) {
        pathChunks.push(commandNameWords[0], `${commandNameWords.join('-')}.md`);
      }
      else {
        pathChunks.push(commandNameWords[0], commandNameWords[1], commandNameWords.slice(1).join('-') + '.md');
      }
    }

    helpFilePath = path.join(...pathChunks);

    if (fs.existsSync(helpFilePath)) {
      Cli.log();

      // because of prism, loading markshell slows down CLI a lot
      // let's lazy-load it only when it's needed (help was requested)
      const markshell: typeof Markshell = require('markshell');
      const chalk: typeof Chalk = require('chalk');
      const theme = markshell.getTheme();
      const admonitionStyles = theme.admonitions.getStyles();
      admonitionStyles.indent.beforeIndent = 0;
      admonitionStyles.indent.titleIndent = 3;
      admonitionStyles.indent.afterIndent = 0;
      theme.admonitions.setStyles(admonitionStyles);
      theme.indents.definitionList = 2;
      theme.headline = chalk.white;
      theme.inlineCode = chalk.cyan;
      theme.sourceCodeTheme = 'solarizelight';
      theme.includePath = path.join(this.commandsFolder, '..', '..', 'docs');
      markshell.setTheme(theme);

      Cli.log(markshell.toRawContent(helpFilePath));
    }
  }

  private printAvailableCommands(): void {
    // commands that match the current group
    const commandsToPrint: { [commandName: string]: CommandInfo } = {};
    // sub-commands in the current group
    const commandGroupsToPrint: { [group: string]: number } = {};
    // current command group, eg. 'spo', 'spo site'
    let currentGroup: string = '';

    const addToList = (commandName: string, command: CommandInfo): void => {
      const pos: number = commandName.indexOf(' ', currentGroup.length + 1);
      if (pos === -1) {
        commandsToPrint[commandName] = command;
      }
      else {
        const subCommandsGroup: string = commandName.substr(0, pos);
        if (!commandGroupsToPrint[subCommandsGroup]) {
          commandGroupsToPrint[subCommandsGroup] = 0;
        }

        commandGroupsToPrint[subCommandsGroup]++;
      }
    };

    // get current command group
    if (this.optionsFromArgs &&
      this.optionsFromArgs.options &&
      this.optionsFromArgs.options._ &&
      this.optionsFromArgs.options._.length > 0) {
      currentGroup = this.optionsFromArgs.options._.join(' ');

      if (currentGroup) {
        currentGroup += ' ';
      }
    }

    const getCommandsForGroup = (): void => {
      for (let i = 0; i < this.commands.length; i++) {
        const command: CommandInfo = this.commands[i];
        if (command.name.startsWith(currentGroup)) {
          addToList(command.name, command);
        }

        if (command.aliases) {
          for (let j = 0; j < command.aliases.length; j++) {
            const alias: string = command.aliases[j];
            if (alias.startsWith(currentGroup)) {
              addToList(alias, command);
            }
          }
        }
      }
    };

    getCommandsForGroup();
    if (Object.keys(commandsToPrint).length === 0 &&
      Object.keys(commandGroupsToPrint).length === 0) {
      // specified string didn't match any commands. Reset group and try again
      currentGroup = '';
      getCommandsForGroup();
    }

    const namesOfCommandsToPrint: string[] = Object.keys(commandsToPrint);
    if (namesOfCommandsToPrint.length > 0) {
      // determine the length of the longest command name to pad strings + ' [options]'
      const maxLength: number = Math.max(...namesOfCommandsToPrint.map(s => s.length)) + 10;

      Cli.log(`Commands:`);
      Cli.log();

      for (const commandName in commandsToPrint) {
        Cli.log(`  ${`${commandName} [options]`.padEnd(maxLength, ' ')}  ${commandsToPrint[commandName].command.description}`);
      }
    }

    const namesOfCommandGroupsToPrint: string[] = Object.keys(commandGroupsToPrint);
    if (namesOfCommandGroupsToPrint.length > 0) {
      if (namesOfCommandsToPrint.length > 0) {
        Cli.log();
      }

      // determine the longest command group name to pad strings + ' *'
      const maxLength: number = Math.max(...namesOfCommandGroupsToPrint.map(s => s.length)) + 2;

      Cli.log(`Commands groups:`);
      Cli.log();

      // sort commands groups (because of aliased commands)
      const sortedCommandGroupsToPrint = Object
        .keys(commandGroupsToPrint)
        .sort()
        .reduce((object: { [group: string]: number }, key: string) => {
          object[key] = commandGroupsToPrint[key];
          return object;
        }, {});

      for (const commandGroup in sortedCommandGroupsToPrint) {
        Cli.log(`  ${`${commandGroup} *`.padEnd(maxLength, ' ')}  ${commandGroupsToPrint[commandGroup]} command${commandGroupsToPrint[commandGroup] === 1 ? '' : 's'}`);
      }
    }

    Cli.log();
  }

  private closeWithError(error: any, showHelpIfEnabled: boolean = false): void {
    const chalk: typeof Chalk = require('chalk');
    let exitCode: number = 1;

    if (error instanceof CommandError) {
      if (error.code) {
        exitCode = error.code;
      }

      Cli.error(chalk.red(`Error: ${error.message}`));
    }
    else {
      Cli.error(chalk.red(`Error: ${error}`));
    }

    if (showHelpIfEnabled &&
      this.getSettingWithDefaultValue<boolean>(settingsNames.showHelpOnFailure, showHelpIfEnabled)) {
      Cli.log();
      this.printHelp(exitCode);
    }
    else {
      process.exit(exitCode);
    }

    // will never be run. Required for testing where we're stubbing process.exit
    /* c8 ignore next */
    throw new Error();
    /* c8 ignore next */
  }

  private static log(message?: any, ...optionalParams: any[]): void {
    if (message) {
      console.log(message, ...optionalParams);
    }
    else {
      console.log();
    }
  }

  private static error(message?: any, ...optionalParams: any[]): void {
    const errorOutput: string = Cli.getInstance().getSettingWithDefaultValue(settingsNames.errorOutput, 'stderr');
    if (errorOutput === 'stdout') {
      console.log(message, ...optionalParams);
    }
    else {
      console.error(message, ...optionalParams);
    }
  }

  public static prompt(options: any, cb: (result: any) => void): void {
    const inquirer: Inquirer = require('inquirer');
    inquirer
      .prompt(options)
      .then(result => cb(result));
  }

  private static removeShortOptions(args: { options: minimist.ParsedArgs }): { options: minimist.ParsedArgs } {
    const filteredArgs = JSON.parse(JSON.stringify(args));
    const optionsToRemove: string[] = Object.getOwnPropertyNames(args.options)
      .filter(option => option.length === 1 || option === '--');
    optionsToRemove.forEach(option => delete filteredArgs.options[option]);

    return filteredArgs;
  }

  private static loadOptionValuesFromFiles(args: { options: minimist.ParsedArgs }) {
    const optionNames: string[] = Object.getOwnPropertyNames(args.options);
    optionNames.forEach(option => {
      const value = args.options[option];
      if (!value ||
        typeof value !== 'string' ||
        !value.startsWith('@')) {
        return;
      }

      const filePath: string = value.substr(1);
      // if the file doesn't exist, leave as-is, if it exists replace with
      // contents from the file
      if (fs.existsSync(filePath)) {
        args.options[option] = fs.readFileSync(filePath, 'utf-8');
      }
    });
  }
}