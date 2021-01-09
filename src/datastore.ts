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

export interface DataStore {
    create<T extends Storable>(collectionPath : string, data : T): Promise<T>;
    transact<T>(handler : (txn : Transaction) => Promise<T>);
    read<T extends Storable>(docPath : string): Promise<T>;
    query<T extends Storable>(collectionPath : string): Query<T>;
    listAll<T extends Storable>(collectionPath : string, limit? : number, startAfter? : string): Promise<T[]>;
    update<T extends Storable>(docPath : string, data : Partial<T>): Promise<void>;
    delete(docPath : string): Promise<void>;
    mirrorInTransaction(txn : Transaction, primaryKey : string, mirrorKeys : string[], data?): Promise<void>;
    mirror(primaryKey : string, mirrorKeys : string[], data?): Promise<void>;
    createAndMirror<T extends Storable>(collectionPath : string, data : T, mirrorKeys : string[]): Promise<T>;
    multiUpdate<T extends Storable>(docPaths : string[], data : T): Promise<void>;
}