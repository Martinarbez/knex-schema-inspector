import Knex from 'knex';
import { SchemaInspector } from '../types/schema-inspector';
import { Table } from '../types/table';
import { Column } from '../types/column';

type RawTable = {
  TABLE_NAME: string;
  TABLE_SCHEMA: string;
  TABLE_COMMENT: string | null;
  ENGINE: string;
  TABLE_COLLATION: string;
};

type RawColumn = {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_DEFAULT: any | null;
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  IS_NULLABLE: boolean;
  COLLATION_NAME: string | null;
  COLUMN_COMMENT: string | null;
  REFERENCED_TABLE_NAME: string | null;
  REFERENCED_COLUMN_NAME: string | null;
  UPDATE_RULE: string | null;
  DELETE_RULE: string | null;

  /** @TODO Extend with other possible values */
  COLUMN_KEY: 'PRI' | null;
  EXTRA: 'auto_increment' | null;
  CONSTRAINT_NAME: 'PRIMARY' | null;
};

export default class MySQL implements SchemaInspector {
  knex: Knex;

  constructor(knex: Knex) {
    this.knex = knex;
  }

  // Tables
  // ===============================================================================================

  /**
   * List all existing tables in the current schema/database
   */
  async tables() {
    const records = await this.knex
      .select<{ table_name: string }[]>('table_namename')
      .from('information_schema.tables')
      .where({
        table_type: 'BASE TABLE',
        table_schema: this.knex.client.database(),
      });
    return records.map(({ table_name }) => table_name);
  }

  /**
   * Get the table info for a given table. If table parameter is undefined, it will return all tables
   * in the current schema/database
   */
  tableInfo(): Promise<Table[]>;
  tableInfo(table: string): Promise<Table>;
  async tableInfo<T>(table?: string) {
    const query = this.knex
      .select(
        'TABLE_NAME',
        'ENGINE',
        'TABLE_SCHEMA',
        'TABLE_COLLATION',
        'TABLE_COMMENT'
      )
      .from('information_schema.tables')
      .where({
        table_schema: this.knex.client.database(),
        table_type: 'BASE TABLE',
      });

    if (table) {
      const rawTable: RawTable = await query
        .andWhere({ table_name: table })
        .first();

      return {
        name: rawTable.TABLE_NAME,
        schema: rawTable.TABLE_SCHEMA,
        comment: rawTable.TABLE_COMMENT,
        collation: rawTable.TABLE_COLLATION,
        engine: rawTable.ENGINE,
      } as T extends string ? Table : Table[];
    }

    const records: RawTable[] = await query;

    return records.map(
      (rawTable): Table => {
        return {
          name: rawTable.TABLE_NAME,
          schema: rawTable.TABLE_SCHEMA,
          comment: rawTable.TABLE_COMMENT,
          collation: rawTable.TABLE_COLLATION,
          engine: rawTable.ENGINE,
        };
      }
    ) as T extends string ? Table : Table[];
  }

  /**
   * Check if a table exists in the current schema/database
   */
  async hasTable(table: string): Promise<boolean> {
    const { count } = this.knex
      .count<{ count: 0 | 1 }>({ count: '*' })
      .from('information_schema.tables')
      .where({ table_schema: this.knex.client.database(), table_name: table })
      .first();
    return !!count;
  }

  // Columns
  // ===============================================================================================

  /**
   * Get all the available columns in the current schema/database. Can be filtered to a specific table
   */
  async columns(table?: string) {
    const query = this.knex
      .select<{ table_name: string; column_name: string }[]>(
        'table_name',
        'column_name'
      )
      .from('information_schema.columns')
      .where({ table_schema: this.knex.client.database() });

    if (table) {
      query.andWhere({ table_name: table });
    }

    const records = await query;

    return records.map(({ table_name, column_name }) => ({
      table: table_name,
      column: column_name,
    }));
  }

  /**
   * Get the column info for all columns, columns in a given table, or a specific column.
   */
  columnInfo(): Promise<Column[]>;
  columnInfo(table: string): Promise<Column[]>;
  columnInfo(table: string, column: string): Promise<Column>;
  async columnInfo<T>(table?: string, column?: string) {
    const query = this.knex
      .select(
        'c.TABLE_NAME',
        'c.COLUMN_NAME',
        'c.COLUMN_DEFAULT',
        'c.DATA_TYPE',
        'c.CHARACTER_MAXIMUM_LENGTH',
        'c.IS_NULLABLE',
        'c.COLUMN_KEY',
        'c.EXTRA',
        'c.COLLATION_NAME',
        'c.COLUMN_COMMENT',
        'fk.REFERENCED_TABLE_NAME',
        'fk.REFERENCED_COLUMN_NAME',
        'fk.CONSTRAINT_NAME',
        'rc.UPDATE_RULE',
        'rc.DELETE_RULE',
        'rc.MATCH_OPTION'
      )
      .from('INFORMATION_SCHEMA.COLUMNS as c')
      .leftJoin('INFORMATION_SCHEMA.KEY_COLUMN_USAGE as fk', function () {
        this.on('fk.TABLE_NAME', '=', 'fk.TABLE_NAME')
          .andOn('fk.COLUMN_NAME', '=', 'c.COLUMN_NAME')
          .andOn('fk.CONSTRAINT_SCHEMA', '=', 'c.TABLE_SCHEMA');
      })
      .leftJoin(
        'INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS as rc',
        function () {
          this.on('rc.TABLE_NAME', '=', 'fk.TABLE_NAME')
            .andOn('rc.CONSTRAINT_NAME', '=', 'fk.CONSTRAINT_NAME')
            .andOn('rc.CONSTRAINT_SCHEMA', '=', 'fk.CONSTRAINT_SCHEMA');
        }
      )
      .where({
        'c.TABLE_SCHEMA': this.knex.client.database(),
      });

    if (table) {
      query.andWhere({ 'c.TABLE_NAME': table });
    }

    if (column) {
      const rawColumn: RawColumn = await query
        .andWhere({ 'c.column_name': column })
        .first();

      return {
        name: rawColumn.COLUMN_NAME,
        table: rawColumn.TABLE_NAME,
        type: rawColumn.DATA_TYPE,
        default_value: rawColumn.COLUMN_DEFAULT,
        max_length: rawColumn.CHARACTER_MAXIMUM_LENGTH,
        is_nullable: rawColumn.IS_NULLABLE,
        is_primary_key: rawColumn.CONSTRAINT_NAME === 'PRIMARY',
        has_auto_increment: rawColumn.EXTRA === 'auto_increment',
        foreign_key_column: rawColumn.REFERENCED_COLUMN_NAME,
        foreign_key_table: rawColumn.REFERENCED_TABLE_NAME,
        comment: rawColumn.COLUMN_COMMENT,
        // onDelete: rawColumn.DELETE_RULE,
        // onUpdate: rawColumn.UPDATE_RULE,
      } as Column;
    }

    const records: RawColumn[] = await query;

    return records.map(
      (rawColumn): Column => {
        return {
          name: rawColumn.COLUMN_NAME,
          table: rawColumn.TABLE_NAME,
          type: rawColumn.DATA_TYPE,
          default_value: rawColumn.COLUMN_DEFAULT,
          max_length: rawColumn.CHARACTER_MAXIMUM_LENGTH,
          is_nullable: rawColumn.IS_NULLABLE,
          is_primary_key: rawColumn.CONSTRAINT_NAME === 'PRIMARY',
          has_auto_increment: rawColumn.EXTRA === 'auto_increment',
          foreign_key_column: rawColumn.REFERENCED_COLUMN_NAME,
          foreign_key_table: rawColumn.REFERENCED_TABLE_NAME,
          comment: rawColumn.COLUMN_COMMENT,
          // onDelete: rawColumn.DELETE_RULE,
          // onUpdate: rawColumn.UPDATE_RULE,
        };
      }
    ) as Column[];
  }

  /**
   * Check if a table exists in the current schema/database
   */
  async hasColumn(table: string, column: string): Promise<boolean> {
    const { count } = this.knex
      .count<{ count: 0 | 1 }>({ count: '*' })
      .from('information_schema.tables')
      .where({
        table_schema: this.knex.client.database(),
        table_name: table,
        column_name: column,
      })
      .first();
    return !!count;
  }

  /**
   * Get the primary key column for the given table
   */
  async primary(table: string) {
    const results = await this.knex.raw(
      `SHOW KEYS FROM ?? WHERE Key_name = 'PRIMARY'`,
      table
    );
    return results[0][0]['Column_name'] as string;
  }
}
