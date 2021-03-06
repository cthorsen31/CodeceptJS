const getConfig = require('./utils').getConfig;
const getTestRoot = require('./utils').getTestRoot;
const Codecept = require('../codecept');
const container = require('../container');
const methodsOfObject = require('../utils').methodsOfObject;
const output = require('../output');
const { toTypeDef } = require('../parser');
const fs = require('fs');
const path = require('path');

const template = `
type ICodeceptCallback = (i: CodeceptJS.{{I}}{{callbackParams}}) => void;

declare class FeatureConfig {
  retry(times: number): FeatureConfig
  timeout(seconds: number): FeatureConfig
  config(config: object): FeatureConfig
  config(helperName: string, config: object): FeatureConfig
}

declare class ScenarioConfig {
  throws(err: any): ScenarioConfig;
  fails(): ScenarioConfig;
  retry(times: number): ScenarioConfig
  timeout(timeout: number): ScenarioConfig
  inject(inject: object): ScenarioConfig
  config(config: object): ScenarioConfig
  config(helperName: string, config: object): ScenarioConfig
  injectDependencies(dependencies: { [key: string]: any }): ScenarioConfig
}

interface ILocator {
  id?: string;
  xpath?: string;
  css?: string;
  name?: string;
  frame?: string;
  android?: string;
  ios?: string;
}

type LocatorOrString = string | ILocator | Locator;

declare class Helper {
  /** Abstract method to provide required config options */
  static _config(): any;
  /** Abstract method to validate config */
  _validateConfig<T>(config: T): T;
  /** Sets config for current test */
  _setConfig(opts: any): void;
  /** Hook executed before all tests */
  _init(): void
  /** Hook executed before each test. */
  _before(): void
  /** Hook executed after each test */
  _after(): void
  /**
   * Hook provides a test details
   * Executed in the very beginning of a test
   */
  _test(test: () => void): void
  /** Hook executed after each passed test */
  _passed(test: () => void): void
  /** Hook executed after each failed test */
  _failed(test: () => void): void
  /** Hook executed before each step */
  _beforeStep(step: () => void): void
  /** Hook executed after each step */
  _afterStep(step: () => void): void
  /** Hook executed before each suite */
  _beforeSuite(suite: () => void): void
  /** Hook executed after each suite */
  _afterSuite(suite: () => void): void
  /** Hook executed after all tests are executed */
  _finishTest(suite: () => void): void
  /**Access another configured helper: this.helpers['AnotherHelper'] */
  readonly helpers: any
  /** Print debug message to console (outputs only in debug mode) */
  debug(msg: string): void

  debugSection(section: string, msg: string): void
}

declare class Locator {
  constructor(locator: LocatorOrString, defaultType?: string);

  or(locator: LocatorOrString): Locator;
  find(locator: LocatorOrString): Locator;
  withChild(locator: LocatorOrString): Locator;
  withDescendant(locator: LocatorOrString): Locator;
  at(position: number): Locator;
  first(): Locator;
  last(): Locator;
  inside(locator: LocatorOrString): Locator;
  before(locator: LocatorOrString): Locator;
  after(locator: LocatorOrString): Locator;
  withText(text: string): Locator;
  withAttr(attrs: object): Locator;
  as(output: string): Locator;
}


declare function actor(customSteps?: {
  [action: string]: (this: CodeceptJS.I, ...args: any[]) => void
}): CodeceptJS.{{I}};
declare function actor(customSteps?: {}): CodeceptJS.{{I}};
declare function Feature(title: string, opts?: {}): FeatureConfig;
declare const Scenario: {
  (title: string, callback: ICodeceptCallback): ScenarioConfig;
  (title: string, opts: {}, callback: ICodeceptCallback): ScenarioConfig;
  only(title: string, callback: ICodeceptCallback): ScenarioConfig;
  only(title: string, opts: {}, callback: ICodeceptCallback): ScenarioConfig;
}
declare interface IScenario {
  Scenario(title: string, callback: ICodeceptCallback): ScenarioConfig;
  Scenario(title: string, opts: {}, callback: ICodeceptCallback): ScenarioConfig;
}
declare function xScenario(title: string, callback: ICodeceptCallback): ScenarioConfig;
declare function xScenario(title: string, opts: {}, callback: ICodeceptCallback): ScenarioConfig;
declare interface IData {
  Scenario(title: string, callback: ICodeceptCallback): ScenarioConfig;
  Scenario(title: string, opts: {}, callback: ICodeceptCallback): ScenarioConfig;
  only: IScenario;
}
declare function Data(data: any): IData;
declare function xData(data: any): IData;
declare function Before(callback: ICodeceptCallback): void;
declare function BeforeSuite(callback: ICodeceptCallback): void;
declare function After(callback: ICodeceptCallback): void;
declare function AfterSuite(callback: ICodeceptCallback): void;

declare function inject(): { [key: string]: any };
declare function locate(selector: LocatorOrString): Locator;
declare function within(selector: LocatorOrString, callback: Function): Promise<any>;
declare function session(selector: LocatorOrString, callback: Function): Promise<any>;
declare function session(selector: LocatorOrString, config: any, callback: Function): Promise<any>;
declare function pause(): void;
declare function secret(secret: any): string;

declare const codeceptjs: any;

declare namespace CodeceptJS {
  export interface {{I}} {
{{methods}}
  }
{{exportPageObjects}}
}

declare module "codeceptjs" {
  export = CodeceptJS;
}
`;

const pageObjectTemplate = `
  export interface {{name}} {
{{methods}}
  }
`;

module.exports = function (genPath, options) {
  const configFile = options.config || genPath;
  const testsPath = getTestRoot(configFile);
  const config = getConfig(configFile);
  if (!config) return;

  const targetFolderPath = options.output && getTestRoot(options.output) || testsPath;

  const codecept = new Codecept(config, {});
  codecept.init(testsPath);

  const helpers = container.helpers();
  const suppportI = container.support('I');
  const translations = container.translation();
  let methods = [];
  const actions = [];
  for (const name in helpers) {
    const helper = helpers[name];
    methods = addAllMethodsInObject(helper, actions, methods, translations);
  }
  methods = addAllNamesInObject(suppportI, actions, methods);

  const supports = container.support(); // return all support objects
  const exportPageObjects = [];
  const callbackParams = [];
  for (const name in supports) {
    if (name === 'I') continue;
    callbackParams.push(`${name}:CodeceptJS.${name}`);
    const pageObject = supports[name];
    const pageMethods = addAllMethodsInObject(pageObject, {}, []);
    let pageObjectExport = pageObjectTemplate.replace('{{methods}}', pageMethods.join(''));
    pageObjectExport = pageObjectExport.replace('{{name}}', name);
    exportPageObjects.push(pageObjectExport);
  }

  let definitionsTemplate = template.replace('{{methods}}', methods.join(''));
  definitionsTemplate = definitionsTemplate.replace('{{exportPageObjects}}', exportPageObjects.join('\n'));
  definitionsTemplate = definitionsTemplate.replace('{{callbackParams}}', `, ${[...callbackParams, '...args: any'].join(', ')}`);
  if (translations) {
    definitionsTemplate = definitionsTemplate.replace(/\{\{I\}\}/g, translations.I);
  }

  fs.writeFileSync(path.join(targetFolderPath, 'steps.d.ts'), definitionsTemplate);
  output.print('TypeScript Definitions provide autocompletion in Visual Studio Code and other IDEs');
  output.print('Definitions were generated in steps.d.ts');
};

function addAllMethodsInObject(supportObj, actions, methods, translations) {
  for (const action of methodsOfObject(supportObj)) {
    const fn = supportObj[action];
    if (!fn.name) {
      Object.defineProperty(fn, 'name', { value: action });
    }
    const actionAlias = translations ? translations.actionAliasFor(action) : action;
    if (!actions[actionAlias]) {
      methods.push(toTypeDef(fn));
      actions[actionAlias] = 1;
    }
  }
  return methods;
}

function addAllNamesInObject(supportObj, actions, methods) {
  for (const name in supportObj) {
    if (actions[name]) {
      continue;
    }
    const actor = supportObj[name];
    let params = toTypeDef(actor);
    if (params !== undefined) {
      if (params.indexOf(' : ') > 0) {
        if (params.indexOf(' (') > 0) {
          params = params.trim();
          methods.push(`    ${(name)}${params}\n`);
        } else {
          methods.push(`${params}`);
        }
      } else {
        methods.push(`    ${(name)}: (${params}) => any; \n`);
      }
    }
  }
  return methods;
}
