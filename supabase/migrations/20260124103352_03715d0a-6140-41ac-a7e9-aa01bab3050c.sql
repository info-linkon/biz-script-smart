-- Delete users from auth.users (except admin@linkon.dev)
DELETE FROM auth.users WHERE id IN (
  '4e80d922-42b5-47e3-9803-9d092c0ba2f3',
  'b350aa51-fb79-41e9-a57c-add23ed39564',
  'cfbeece4-8af5-4f22-aee5-1e5696020094',
  '4401e336-9f9b-4f37-ae3e-226ba2211edd',
  '43b0fbbe-6b7e-4e13-9109-e6ce49e63c42'
);