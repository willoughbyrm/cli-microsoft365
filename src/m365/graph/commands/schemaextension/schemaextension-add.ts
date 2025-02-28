import { Logger } from '../../../../cli';
import {
  CommandOption
} from '../../../../Command';
import GlobalOptions from '../../../../GlobalOptions';
import request from '../../../../request';
import Utils from '../../../../Utils';
import GraphCommand from '../../../base/GraphCommand';
import commands from '../../commands';

interface CommandArgs {
  options: Options;
}

interface Options extends GlobalOptions {
  description: string;
  id: string;
  owner: string;
  properties: string;
  targetTypes: string;
}

class GraphSchemaExtensionAdd extends GraphCommand {
  public get name(): string {
    return commands.SCHEMAEXTENSION_ADD;
  }

  public get description(): string {
    return 'Creates a Microsoft Graph schema extension';
  }

  public commandAction(logger: Logger, args: CommandArgs, cb: () => void): void {
    if (this.verbose) {
      logger.logToStderr(`Adding schema extension with id '${args.options.id}'...`);
    }

    const targetTypes: string[] = args.options.targetTypes.split(',').map(t => t.trim());
    const properties: any = JSON.parse(args.options.properties);

    const requestOptions: any = {
      url: `${this.resource}/v1.0/schemaExtensions`,
      headers: {
        accept: 'application/json;odata.metadata=none',
        'content-type': 'application/json'
      },
      data: {
        id: args.options.id,
        description: args.options.description,
        owner: args.options.owner,
        targetTypes,
        properties
      },
      responseType: 'json'
    };

    request
      .post(requestOptions)
      .then((res: any): void => {
        logger.log(res);
        cb();
      }, (err: any) => this.handleRejectedODataJsonPromise(err, logger, cb));
  }

  public options(): CommandOption[] {
    const options: CommandOption[] = [
      {
        option: '-i, --id <id>'
      },
      {
        option: '-d, --description [description]'
      },
      {
        option: '--owner <owner>'
      },
      {
        option: '-t, --targetTypes <targetTypes>'
      },
      {
        option: '-p, --properties <properties>'
      }
    ];

    const parentOptions: CommandOption[] = super.options();
    return options.concat(parentOptions);
  }

  public validate(args: CommandArgs): boolean | string {
    if (args.options.owner && !Utils.isValidGuid(args.options.owner)) {
      return `The specified owner '${args.options.owner}' is not a valid App Id`;
    }

    return this.validateProperties(args.options.properties);
  }

  private validateProperties(propertiesString: string): boolean | string {
    let result: boolean | string = false;

    try {
      const properties: any = JSON.parse(propertiesString);

      // If the properties object is not an array
      if (properties.length === undefined) {
        result = 'The specified JSON string is not an array';
      }
      else {
        for (let i: number = 0; i < properties.length; i++) {
          const property: any = properties[i];
          if (!property.name) {
            result = `Property ${JSON.stringify(property)} misses name`;
          }

          if (!this.isValidPropertyType(property.type)) {
            result = `${property.type} is not a valid property type. Valid types are: Binary, Boolean, DateTime, Integer and String`;
          }
        }

        if (typeof result !== "string") {
          result = true;
        }
      }
    }
    catch (e) {
      result = e;
    }

    return result;
  }

  private isValidPropertyType(propertyType: string): boolean {
    if (!propertyType) {
      return false;
    }

    return ['Binary', 'Boolean', 'DateTime', 'Integer', 'String'].indexOf(propertyType) > -1;
  }
}

module.exports = new GraphSchemaExtensionAdd();