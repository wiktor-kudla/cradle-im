// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from '@signalapp/better-sqlite3';
import { isNumber, last } from 'lodash';

export type EmptyQuery = [];
export type ArrayQuery = Array<ReadonlyArray<null | number | bigint | string>>;
export type Query = {
  [key: string]: null | number | bigint | string | Uint8Array;
};
export type JSONRows = Array<{ readonly json: string }>;

export type TableType =
  | 'attachment_downloads'
  | 'conversations'
  | 'identityKeys'
  | 'items'
  | 'kyberPreKeys'
  | 'messages'
  | 'preKeys'
  | 'senderKeys'
  | 'sessions'
  | 'signedPreKeys'
  | 'stickers'
  | 'unprocessed';

// This value needs to be below SQLITE_MAX_VARIABLE_NUMBER.
const MAX_VARIABLE_COUNT = 100;

export function objectToJSON<T>(data: T): string {
  return JSON.stringify(data);
}

export function jsonToObject<T>(json: string): T {
  return JSON.parse(json);
}

export type QueryTemplateParam = string | number | null | undefined;
export type QueryFragmentValue = QueryFragment | QueryTemplateParam;

export type QueryFragment = [
  { fragment: string },
  ReadonlyArray<QueryTemplateParam>
];

/**
 * You can use tagged template literals to build "fragments" of SQL queries
 *
 * ```ts
 * const [query, params] = sql`
 *   SELECT * FROM examples
 *   WHERE groupId = ${groupId}
 *   ORDER BY timestamp ${asc ? sqlFragment`ASC` : sqlFragment`DESC`}
 * `;
 * ```
 *
 * SQL Fragments can contain other SQL fragments, but must be finalized with
 * `sql` before being passed to `Database#prepare`.
 *
 * The name `sqlFragment` comes from several editors that support SQL syntax
 * highlighting inside JavaScript template literals.
 */
export function sqlFragment(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<QueryFragmentValue>
): QueryFragment {
  let query = '';
  const params: Array<QueryTemplateParam> = [];

  strings.forEach((string, index) => {
    const value = values[index];

    query += string;

    if (index < values.length) {
      if (Array.isArray(value)) {
        const [{ fragment }, fragmentParams] = value;
        query += fragment;
        params.push(...fragmentParams);
      } else {
        query += '?';
        params.push(value);
      }
    }
  });

  return [{ fragment: query }, params];
}

export function sqlConstant(value: QueryTemplateParam): QueryFragment {
  let fragment;
  if (value == null) {
    fragment = 'NULL';
  } else if (typeof value === 'number') {
    fragment = `${value}`;
  } else if (typeof value === 'boolean') {
    fragment = `${value}`;
  } else {
    fragment = `'${value}'`;
  }
  return [{ fragment }, []];
}

/**
 * Like `Array.prototype.join`, but for SQL fragments.
 */
const SQL_JOIN_SEPARATOR = ',';
export function sqlJoin(
  items: ReadonlyArray<QueryFragmentValue>
): QueryFragment {
  let query = '';
  const params: Array<QueryTemplateParam> = [];

  items.forEach((item, index) => {
    const [{ fragment }, fragmentParams] = sqlFragment`${item}`;
    query += fragment;
    params.push(...fragmentParams);

    if (index < items.length - 1) {
      query += SQL_JOIN_SEPARATOR;
    }
  });

  return [{ fragment: query }, params];
}

export type QueryTemplate = [string, ReadonlyArray<QueryTemplateParam>];

/**
 * You can use tagged template literals to build SQL queries
 * that can be passed to `Database#prepare`.
 *
 * ```ts
 * const [query, params] = sql`
 *   SELECT * FROM examples
 *   WHERE groupId = ${groupId}
 *   ORDER BY timestamp ASC
 * `;
 * db.prepare(query).all(params);
 * ```
 *
 * SQL queries can contain other SQL fragments, but cannot contain other SQL
 * queries.
 *
 * The name `sql` comes from several editors that support SQL syntax
 * highlighting inside JavaScript template literals.
 */
export function sql(
  strings: TemplateStringsArray,
  ...values: ReadonlyArray<QueryFragment | QueryTemplateParam>
): QueryTemplate {
  const [{ fragment }, params] = sqlFragment(strings, ...values);
  return [fragment, params];
}

type QueryPlanRow = Readonly<{
  id: number;
  parent: number;
  details: string;
}>;

type QueryPlan = Readonly<{
  query: string;
  plan: ReadonlyArray<QueryPlanRow>;
}>;

/**
 * Returns typed objects of the query plan for the given query.
 *
 *
 * ```ts
 * const [query, params] = sql`
 *   SELECT * FROM examples
 *   WHERE groupId = ${groupId}
 *   ORDER BY timestamp ASC
 * `;
 * log.info('Query plan', explainQueryPlan(db, [query, params]));
 * db.prepare(query).all(params);
 * ```
 */
export function explainQueryPlan(
  db: Database,
  template: QueryTemplate
): QueryPlan {
  const [query, params] = template;
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(params);
  return { query, plan };
}

//
// Database helpers
//

export function getSQLiteVersion(db: Database): string {
  const { sqlite_version: version } = db
    .prepare<EmptyQuery>('select sqlite_version() AS sqlite_version')
    .get();

  return version;
}

export function getSchemaVersion(db: Database): number {
  return db.pragma('schema_version', { simple: true });
}

export function setUserVersion(db: Database, version: number): void {
  if (!isNumber(version)) {
    throw new Error(`setUserVersion: version ${version} is not a number`);
  }
  db.pragma(`user_version = ${version}`);
}

export function getUserVersion(db: Database): number {
  return db.pragma('user_version', { simple: true });
}

export function getSQLCipherVersion(db: Database): string | undefined {
  return db.pragma('cipher_version', { simple: true });
}

//
// Various table helpers
//

export function batchMultiVarQuery<ValueT>(
  db: Database,
  values: ReadonlyArray<ValueT>,
  query: (batch: ReadonlyArray<ValueT>) => void
): [];
export function batchMultiVarQuery<ValueT, ResultT>(
  db: Database,
  values: ReadonlyArray<ValueT>,
  query: (batch: ReadonlyArray<ValueT>) => Array<ResultT>
): Array<ResultT>;

export function batchMultiVarQuery<ValueT, ResultT>(
  db: Database,
  values: ReadonlyArray<ValueT>,
  query:
    | ((batch: ReadonlyArray<ValueT>) => void)
    | ((batch: ReadonlyArray<ValueT>) => Array<ResultT>)
): Array<ResultT> {
  if (values.length > MAX_VARIABLE_COUNT) {
    const result: Array<ResultT> = [];
    db.transaction(() => {
      for (let i = 0; i < values.length; i += MAX_VARIABLE_COUNT) {
        const batch = values.slice(i, i + MAX_VARIABLE_COUNT);
        const batchResult = query(batch);
        if (Array.isArray(batchResult)) {
          result.push(...batchResult);
        }
      }
    })();
    return result;
  }

  const result = query(values);
  return Array.isArray(result) ? result : [];
}

export function createOrUpdate<Key extends string | number>(
  db: Database,
  table: TableType,
  data: Record<string, unknown> & { id: Key }
): void {
  const { id } = data;
  if (!id) {
    throw new Error('createOrUpdate: Provided data did not have a truthy id');
  }

  db.prepare<Query>(
    `
    INSERT OR REPLACE INTO ${table} (
      id,
      json
    ) values (
      $id,
      $json
    )
    `
  ).run({
    id,
    json: objectToJSON(data),
  });
}

export function bulkAdd(
  db: Database,
  table: TableType,
  array: Array<Record<string, unknown> & { id: string | number }>
): void {
  db.transaction(() => {
    for (const data of array) {
      createOrUpdate(db, table, data);
    }
  })();
}

export function getById<Key extends string | number, Result = unknown>(
  db: Database,
  table: TableType,
  id: Key
): Result | undefined {
  const row = db
    .prepare<Query>(
      `
      SELECT *
      FROM ${table}
      WHERE id = $id;
      `
    )
    .get({
      id,
    });

  if (!row) {
    return undefined;
  }

  return jsonToObject(row.json);
}

export function removeById<Key extends string | number>(
  db: Database,
  tableName: TableType,
  id: Key | Array<Key>
): number {
  const table = sqlConstant(tableName);
  if (!Array.isArray(id)) {
    const [query, params] = sql`
      DELETE FROM ${table}
      WHERE id = ${id};
    `;
    return db.prepare(query).run(params).changes;
  }

  if (!id.length) {
    throw new Error('removeById: No ids to delete!');
  }

  let totalChanges = 0;

  const removeByIdsSync = (ids: ReadonlyArray<string | number>): void => {
    const [query, params] = sql`
      DELETE FROM ${table}
      WHERE id IN (${sqlJoin(ids)});
    `;
    totalChanges += db.prepare(query).run(params).changes;
  };

  batchMultiVarQuery(db, id, removeByIdsSync);

  return totalChanges;
}

export function removeAllFromTable(db: Database, table: TableType): number {
  return db.prepare<EmptyQuery>(`DELETE FROM ${table};`).run().changes;
}

export function getAllFromTable<T>(db: Database, table: TableType): Array<T> {
  const rows: JSONRows = db
    .prepare<EmptyQuery>(`SELECT json FROM ${table};`)
    .all();

  return rows.map(row => jsonToObject(row.json));
}

export function getCountFromTable(db: Database, table: TableType): number {
  const result: null | number = db
    .prepare<EmptyQuery>(`SELECT count(*) from ${table};`)
    .pluck(true)
    .get();
  if (isNumber(result)) {
    return result;
  }
  throw new Error(`getCountFromTable: Unable to get count from table ${table}`);
}

export class TableIterator<ObjectType extends { id: string }> {
  constructor(
    private readonly db: Database,
    private readonly table: TableType,
    private readonly pageSize = 500
  ) {}

  *[Symbol.iterator](): Iterator<ObjectType> {
    const fetchObject = this.db.prepare<Query>(
      `
        SELECT json FROM ${this.table}
        WHERE id > $id
        ORDER BY id ASC
        LIMIT $pageSize;
      `
    );

    let complete = false;
    let id = '';
    while (!complete) {
      const rows: JSONRows = fetchObject.all({
        id,
        pageSize: this.pageSize,
      });

      const messages: Array<ObjectType> = rows.map(row =>
        jsonToObject(row.json)
      );
      yield* messages;

      const lastMessage: ObjectType | undefined = last(messages);
      if (lastMessage) {
        ({ id } = lastMessage);
      }
      complete = messages.length < this.pageSize;
    }
  }
}
