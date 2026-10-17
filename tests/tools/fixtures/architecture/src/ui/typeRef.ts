// Fixture: an `import('…')` TYPE reference is erased by TypeScript, so it is a type edge — counted as runtime it
// would make its file pair runtime and hide a real runtime import added to the same pair later.
export type Ref = import('../export/shape').Shape;
