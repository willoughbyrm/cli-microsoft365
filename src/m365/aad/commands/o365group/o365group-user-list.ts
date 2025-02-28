import * as chalk from 'chalk';
import { Logger } from '../../../../cli';
import {
  CommandOption
} from '../../../../Command';
import GlobalOptions from '../../../../GlobalOptions';
import Utils from '../../../../Utils';
import { GraphItemsListCommand } from '../../../base/GraphItemsListCommand';
import teamsCommands from '../../../teams/commands';
import commands from '../../commands';
import { GroupUser } from './GroupUser';

interface CommandArgs {
  options: Options;
}

interface Options extends GlobalOptions {
  role?: string;
  teamId?: string;
  groupId?: string;
}

class AadO365GroupUserListCommand extends GraphItemsListCommand<GroupUser> {
  public get name(): string {
    return commands.O365GROUP_USER_LIST;
  }

  public get description(): string {
    return "Lists users for the specified Microsoft 365 group or Microsoft Teams team";
  }

  public alias(): string[] | undefined {
    return [teamsCommands.TEAMS_USER_LIST];
  }

  public getTelemetryProperties(args: CommandArgs): any {
    const telemetryProps: any = super.getTelemetryProperties(args);
    telemetryProps.role = args.options.role;
    telemetryProps.teamId = typeof args.options.teamId !== 'undefined';
    telemetryProps.groupId = typeof args.options.groupId !== 'undefined';
    return telemetryProps;
  }

  public commandAction(logger: Logger, args: CommandArgs, cb: () => void): void {
    const providedGroupId: string = (typeof args.options.groupId !== 'undefined') ? args.options.groupId : args.options.teamId as string;

    this
      .getOwners(logger, providedGroupId)
      .then((): Promise<void> => {
        if (args.options.role === "Owner") {
          return Promise.resolve();
        }

        return this.getMembersAndGuests(logger, providedGroupId);
      })
      .then(
        (): void => {
          // Filter out duplicate added values for owners (as they are returned as members as well)
          this.items = this.items.filter((groupUser, index, self) =>
            index === self.findIndex((t) => (
              t.id === groupUser.id && t.displayName === groupUser.displayName
            ))
          );

          if (args.options.role) {
            this.items = this.items.filter(i => i.userType === args.options.role);
          }

          logger.log(this.items);

          if (this.verbose) {
            logger.logToStderr(chalk.green("DONE"));
          }

          cb();
        },
        (err: any): void => this.handleRejectedODataJsonPromise(err, logger, cb)
      );
  }

  private getOwners(logger: Logger, groupId: string): Promise<void> {
    const endpoint: string = `${this.resource}/v1.0/groups/${groupId}/owners?$select=id,displayName,userPrincipalName,userType`;

    return this.getAllItems(endpoint, logger, true).then(
      (): void => {
        // Currently there is a bug in the Microsoft Graph that returns Owners as
        // userType 'member'. We therefore update all returned user as owner
        for (const i in this.items) {
          this.items[i].userType = "Owner";
        }
      }
    );
  }

  private getMembersAndGuests(logger: Logger, groupId: string): Promise<void> {
    const endpoint: string = `${this.resource}/v1.0/groups/${groupId}/members?$select=id,displayName,userPrincipalName,userType`;
    return this.getAllItems(endpoint, logger, false);
  }

  public options(): CommandOption[] {
    const options: CommandOption[] = [
      {
        option: "-i, --groupId [groupId]"
      },
      {
        option: "--teamId [teamId]"
      },
      {
        option: "-r, --role [type]",
        autocomplete: ["Owner", "Member", "Guest"]
      }
    ];

    const parentOptions: CommandOption[] = super.options();
    return options.concat(parentOptions);
  }

  public validate(args: CommandArgs): boolean | string {
    if (!args.options.groupId && !args.options.teamId) {
      return 'Please provide one of the following parameters: groupId or teamId';
    }

    if (args.options.groupId && args.options.teamId) {
      return 'You cannot provide both a groupId and teamId parameter, please provide only one';
    }

    if (args.options.teamId && !Utils.isValidGuid(args.options.teamId as string)) {
      return `${args.options.teamId} is not a valid GUID`;
    }

    if (args.options.groupId && !Utils.isValidGuid(args.options.groupId as string)) {
      return `${args.options.groupId} is not a valid GUID`;
    }

    if (args.options.role) {
      if (['Owner', 'Member', 'Guest'].indexOf(args.options.role) === -1) {
        return `${args.options.role} is not a valid role value. Allowed values Owner|Member|Guest`;
      }
    }

    return true;
  }
}

module.exports = new AadO365GroupUserListCommand();