import { Storable, Query, Transaction, DataStore, CollectionParams, CollectionChange, DataStoreSentinels } from "@astronautlabs/datastore";
import * as firebase from 'firebase/app';
import 'firebase/firestore';
import { Observable, Subject, ReplaySubject, ConnectableObservable } from "rxjs";
import { publish } from "rxjs/operators";

/**
 * Specify a modifier for a field instead of a direct field value
 */
export class FbSentinels implements DataStoreSentinels {
    increment(number: number): unknown {
        return firebase.firestore.FieldValue.increment(number);
    }
    serverTimestamp(): unknown {
        return firebase.firestore.FieldValue.serverTimestamp();
    }
    delete(): unknown {
        return firebase.firestore.FieldValue.delete();
    }
    arrayUnion(...elements: any[]): unknown {
        return firebase.firestore.FieldValue.arrayUnion(...elements);
    }
    arrayRemove(...elements: any[]): unknown {
        return firebase.firestore.FieldValue.arrayRemove(...elements);
    }
}

export class FbTransaction implements Transaction {
    constructor(
        private store : FbDataStore,
        private txn : firebase.firestore.Transaction
    ) {
    }

    async create<T extends Storable>(collectionPath : string, data : T): Promise<T> {
        let firestore = this.store.firestore;
        let docRef = firestore.collection(collectionPath).doc();
        
        try {
            await this.txn.set(docRef, data);
        } catch (e) {
            handleError(e, `datastoreTransaction.create('${collectionPath}', ...)`, data);
        }
        data.id = docRef.id;
        return data;
    }
    
    async read<T extends Storable>(docPath : string): Promise<T> {
        try {
            return (await this.txn.get(this.store.firestore.doc(docPath)))?.data() as T;
        } catch (e) {
            handleError(e, `datastoreTransaction.read('${docPath}')`);
        }
    }
    
    async update<T extends Storable>(docPath : string, data : T): Promise<void> {
        try {
            await this.txn.update(this.store.firestore.doc(docPath), data);
        } catch (e) {
            handleError(e, `datastoreTransaction.update('${docPath}', ...)`, data);
        }
    }

    async set<T extends Storable>(docPath : string, data : T): Promise<void> {
        try {
            await this.txn.set(this.store.firestore.doc(docPath), data);
        } catch (e) {
            handleError(e, `datastoreTransaction.set('${docPath}', ...)`, data);
        }
    }

    async delete(docPath : string) {
        try {
            await this.txn.delete(this.store.firestore.doc(docPath));
        } catch (e) {
            handleError(e, `datastoreTransaction.delete('${docPath}', ...)`);
        }
    }

    async readAll(docPaths : string[]): Promise<any[]> {
        return (
                await Promise.all(
                    docPaths
                        .map(docPath => this.store.firestore.doc(docPath))
                        .map(x => this.txn.get(x))
                )
            )
            .map(x => x.data())
        ;
    }
}

class FbQuery<T> implements Query<T> {
    constructor(
        private _query : firebase.firestore.Query
    ) {
    }

    where(fieldName : string, operator : string, value : any) {
        return new FbQuery<T>(this._query.where(fieldName, operator as any, value));
    }

    async get() {
        let snapshot = await this._query.get();
        return snapshot.docs.map(x => x.data()) as T[];
    }
}

interface LazyConnectionOptions<T> {
    start : (subject : Subject<T>) => void;
    stop : () => void;
}

function lazyConnection<T>(options : LazyConnectionOptions<T>): Observable<T> {
    let obs = new Observable(observer => {
        let subject = new Subject<T>();
        let subscription = subject.subscribe(observer);
        options.start(subject);
        return () => {
            subscription.unsubscribe();
            options.stop();
        };
    });
    
    return (<ConnectableObservable<T>>obs.pipe(publish())).refCount();
}

function printError(error : any, operationName : string, data? : any) {
    console.groupCollapsed(`Error '${error.message}' during ${operationName}`);

    console.log(`Details:`);
    console.error(error);
    
    if (data) {
        console.log(`Data:`);
        console.dir(data);
    }

    console.groupEnd();
}

function handleError(error : any, operationName : string, data? : any) {
    printError(error, operationName, data);
    throw error;
}

export class FbDataStore implements DataStore {
    constructor(
        readonly firestore : firebase.firestore.Firestore
    ) {
    }

    sentinels = new FbSentinels();

    async set<T extends Storable>(docPath: string, data: T): Promise<void> {
        try {
            await this.firestore.doc(docPath).set(data);
        } catch (e) {
            handleError(e, `datastore.set('${docPath}', ...)`, data);
        }
    }
    
    async create<T extends Storable>(collectionPath : string, data : T): Promise<T> {
        let colRef = this.firestore.collection(collectionPath);
        let docRef : firebase.firestore.DocumentReference;
        
        try {
            docRef = await colRef.add(data);
        } catch (e) {
            handleError(e, `datastore.create('${collectionPath}', ...)`, data);
        }
        
        data.id = docRef.id;
        return data;
    }

    async transact<T>(handler : (txn : FbTransaction) => Promise<T>) {
        return await this.firestore.runTransaction(async fsTxn => {
            let txn = new FbTransaction(this, fsTxn);
            return await handler(txn);
        });
    }
    
    async read<T extends Storable>(docPath : string): Promise<T> {
        let docRef = this.firestore.doc(docPath);
        let snap : firebase.firestore.DocumentSnapshot;


        try {
            snap = await docRef.get();
        } catch (e) {
            handleError(e, `datastore.read('${docPath}')`);
        }

        let t = snap.data() as T;
        if (t) 
            t.id = docRef.id;
        return t;
    }

    query<T extends Storable>(collectionPath : string): Query<T> {
        return new FbQuery(this.firestore.collection(collectionPath));
    }

    watch<T extends Storable>(docPath: string): Observable<T> {
        let doc = this.firestore.doc(docPath);
        let unsub : () => void;
        return lazyConnection<T>({
            start: (subject) => {
                unsub = doc.onSnapshot({
                    next: snap => subject.next(<T>snap.data()),
                    error: error => (printError(error, `watch('${docPath}')`), subject.error(error))
                });
            }, stop: () => unsub()
        });
    }
    
    watchForChanges<T extends Storable>(collectionPath : string, params? : CollectionParams): Observable<CollectionChange<T>[]> {
        let collection : firebase.firestore.Query = this.firestore.collection(collectionPath);

        if (params?.order)
            collection = collection.orderBy(params?.order?.field, params?.order?.direction);
        
        if (params?.limit)
            collection = collection.limit(params?.limit);

        if (params?.startAfter)
            collection = collection.startAfter(params?.startAfter);

        let unsub : () => void;
        return lazyConnection<CollectionChange<T>[]>({
            start: (subject) => unsub = collection.onSnapshot(snap => subject.next(<CollectionChange<T>[]>snap.docChanges().map(x => ({ type: x.type, document: x.doc.data() })))),
            stop: () => unsub()
        });
    }

    watchAll<T extends Storable>(collectionPath: string, params? : CollectionParams): Observable<T[]> {
        let collection : firebase.firestore.Query = this.firestore.collection(collectionPath);
        
        if (params?.order)
            collection = collection.orderBy(params?.order?.field, params?.order?.direction);
        
        if (params?.limit)
            collection = collection.limit(params?.limit);

        if (params?.startAfter)
            collection = collection.startAfter(params?.startAfter);

        let unsub : () => void;
        return lazyConnection<T[]>({
            start: (subject) => unsub = collection.onSnapshot({
                next: snap => subject.next(<T[]>snap.docs.map(x => x.data())),
                error: error => (printError(error, `watchAll('${collectionPath}')`), subject.error(error))
            }),
            stop: () => unsub()
        });
    }

    async listAll<T extends Storable>(collectionPath : string, params? : CollectionParams): Promise<T[]> {

        let collection : firebase.firestore.Query = this.firestore.collection(collectionPath);

        if (params?.order)
            collection = collection.orderBy(params?.order?.field, params?.order?.direction);
        
        if (params?.limit)
            collection = collection.limit(params?.limit);

        if (params?.startAfter)
            collection = collection.startAfter(params?.startAfter);

        let snap : firebase.firestore.QuerySnapshot;
        
        try {
            snap = await collection.get();
        } catch (e) {
            handleError(e, `datastore.listAll('${collectionPath}')`);
        }
        
        return snap
            .docs
            .map(x => Object.assign(
                {}, 
                x.data(), 
                { id: x.id }
            )
        ) as T[];
    }

    async update<T extends Storable>(docPath : string, data : Partial<T>): Promise<void> {
        let docRef = this.firestore.doc(docPath);
        
        try {
            await docRef.set(data, { merge: true });
        } catch (e) {
            handleError(e, `datastore.update('${docPath}')`);
        }
    }
    
    async delete(docPath : string): Promise<void> {
        let docRef = this.firestore.doc(docPath);
        
        try {
            await docRef.delete();
        } catch (e) {
            handleError(e, `datastore.delete('${docPath}')`);
        }
    }

    async mirrorInTransaction(txn : FbTransaction, primaryKey : string, mirrorKeys : string[], data?): Promise<void> {
        try {
            if (!data)
                data = await txn.read(primaryKey);
        } catch (e) {
            console.error(`Caught error while fetching content for mirroring from '${primaryKey}' (would have mirrored to ${mirrorKeys.length} keys: ${mirrorKeys.join(', ')})`);
            console.error(e);

            console.groupCollapsed('Debug Details');
            console.dir(`Object view of error:`);
            console.dir(e);
            console.groupEnd();
            throw e;
        }

        if (!data)
            throw new Error(`No such object ${primaryKey}`);
        
        try {
            await Promise.all(mirrorKeys.map(key => txn.set(key, data)));
        } catch (e) {
            console.error(`Caught error while mirroring content from '${primaryKey}' to ${mirrorKeys.length} keys: ${mirrorKeys.join(', ')}`);
            console.error(e);
            console.groupCollapsed('Debug Details');
            console.dir(`Object view of error:`);
            console.dir(e);
            console.log(`The data being mirrored:`);
            console.dir(data);
            console.groupEnd();
            throw e;
        }
    }

    async mirror(primaryKey : string, mirrorKeys : string[], data?): Promise<void> {
        let primaryRef = this.firestore.doc(primaryKey);
        let mirrorRefs = mirrorKeys.map(x => this.firestore.doc(x));

        try {
            if (!data)
                data = (await primaryRef.get()).data();
        } catch (e) {
            console.error(`Caught error while fetching content for mirroring from '${primaryKey}' (would have mirrored to ${mirrorKeys.length} keys: ${mirrorKeys.join(', ')})`);
            console.error(e);

            console.groupCollapsed('Debug Details');
            console.dir(`Object view of error:`);
            console.dir(e);
            console.groupEnd();
            throw e;
        }

        if (!data)
            throw new Error(`No such object ${primaryKey}`);
        
        try {
            await Promise.all(mirrorRefs.map(ref => ref.set(data)));
        } catch (e) {
            console.error(`Caught error while mirroring content from '${primaryKey}' to ${mirrorKeys.length} keys: ${mirrorKeys.join(', ')}`);
            console.error(e);
            console.groupCollapsed('Debug Details');
            console.dir(`Object view of error:`);
            console.dir(e);
            console.log(`The data being mirrored:`);
            console.dir(data);
            console.groupEnd();
            throw e;
        }
    }

    async createAndMirror<T extends Storable>(collectionPath : string, data : T, mirrorKeys : string[]): Promise<T> {
        let record : T;
        
        await this.transact(async txn => {
            try {
                record = await txn.create(collectionPath, data);
            } catch (e) {
                console.error(`Caught error while creating entry in '${collectionPath}' (and mirroring to ${mirrorKeys.length} keys: ${mirrorKeys.join(', ')})`);
                console.error(e);
                console.groupCollapsed('Debug Details');
                console.dir(`Object view of error:`);
                console.dir(e);
                console.log(`The data being written:`);
                console.dir(data);
                console.groupEnd();
                throw e;
            }
            
            await this.mirrorInTransaction(
                txn, 
                `${collectionPath}/${record.id}`, 
                mirrorKeys.map(key => key.replace(/:id/g, record.id)),
                record
            );
        });

        try {
            record = await this.create(collectionPath, data);
        } catch (e) {
            console.error(`Caught error while creating entry in '${collectionPath}' (and mirroring to ${mirrorKeys.length} keys: ${mirrorKeys.join(', ')})`);
            console.error(e);
            console.groupCollapsed('Debug Details');
            console.dir(`Object view of error:`);
            console.dir(e);
            console.log(`The data being written:`);
            console.dir(data);
            console.groupEnd();
            throw e;
        }

        await this.mirror(`${collectionPath}/${record.id}`, mirrorKeys.map(key => key.replace(/:id/g, record.id), record));
        return record;
    }

    async multiUpdate<T extends Storable>(docPaths : string[], data : T): Promise<void> {
        try {
            await Promise.all(docPaths.map(path => this.update(path, data)));
        } catch (e) {            
            console.error(`Caught error during multi-update to ${docPaths.length} keys: ${docPaths.join(', ')})`);
            console.error(e);
            console.groupCollapsed('Debug Details');
            console.dir(`Object view of error:`);
            console.dir(e);
            console.log(`The data being written:`);
            console.dir(data);
            console.groupEnd();
            throw e;
        }
    }
}