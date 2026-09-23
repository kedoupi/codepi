export const skillBuilderUrlOwnedKeys = Object.freeze([
  'template',
  'client',
  'name',
  'purpose',
  'trigger',
  'steps',
  'inputs',
  'output',
  'limits',
  'safety',
]);

export function getSkillBuilderUrlState(data) {
  return {
    state: {
      template: data.template,
      client: data.client,
    },
    ownedKeys: skillBuilderUrlOwnedKeys,
  };
}
