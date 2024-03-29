import { Observable } from 'rxjs';

export interface Storable {
    id? : string;
}

export interface Transaction {
    create<T extends Storable>(collectionPath : string, data : T): Promise<T>;
    read<T extends Storable>(docPath : string): Promise<T>;
    update<T extends Storable>(docPath : string, data : T): Promise<void>;
    set<T extends Storable>(docPath : string, data : T): Promise<void>;
    delete(docPath : string) : Promise<void>;
    readAll(docPaths : string[]): Promise<any[]>;
}

export interface Query<T> {
    where(fieldName : string, operator : string, value : any): Query<T>;
    get() : Promise<T[]>;
}

export interface Order {
    field : string;
    direction : 'asc' | 'desc';
}

export interface CollectionParams {
    order? : Order;
    limit? : number;
    startAfter? : string;
}

export interface CollectionChange<T> {
    type : 'added' | 'modified' | 'removed';
    document : T;
}
export interface DataStore {
    create<T extends Storable>(collectionPath : string, data : T): Promise<T>;
    transact<T>(handler : (txn : Transaction) => Promise<T>);
    read<T extends Storable>(docPath : string): Promise<T>;
    query<T extends Storable>(collectionPath : string): Query<T>;
    listAll<T extends Storable>(collectionPath : string, params? : CollectionParams): Promise<T[]>;
    watchAll<T extends Storable>(collectionPath : string, params? : CollectionParams) : Observable<T[]>;
    watchForChanges<T extends Storable>(collectionPath : string, params? : CollectionParams) : Observable<CollectionChange<T>[]>;
    watch<T extends Storable>(docPath : string) : Observable<T>;
    set<T extends Storable>(docPath: string, data: T): Promise<void>;
    update<T extends Storable>(docPath : string, data : Partial<T>): Promise<void>;
    delete(docPath : string): Promise<void>;
    mirrorInTransaction(txn : Transaction, primaryKey : string, mirrorKeys : string[], data?): Promise<void>;
    mirror(primaryKey : string, mirrorKeys : string[], data?): Promise<void>;
    createAndMirror<T extends Storable>(collectionPath : string, data : T, mirrorKeys : string[]): Promise<T>;
    multiUpdate<T extends Storable>(docPaths : string[], data : T): Promise<void>;

    sentinels? : DataStoreSentinels;
}

/**
 * Specify a modifier for a field instead of a direct field value
 */
export interface DataStoreSentinels {
    increment(number : number) : unknown;
    serverTimestamp() : unknown;
    delete() : unknown;
    arrayUnion(...elements : any[]) : unknown;
    arrayRemove(...elements : any[]) : unknown;

}