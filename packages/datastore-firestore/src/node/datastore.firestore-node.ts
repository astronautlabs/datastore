import { Storable, Query, Transaction, DataStore, CollectionParams, CollectionChange, DataStoreSentinels } from "@astronautlabs/datastore";
import { Observable, ConnectableObservable, Subject } from 'rxjs';
import { publish } from 'rxjs/operators';
import * as firebase from 'firebase-admin';

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
            console.error(`Caught error during datastore transaction.create('${collectionPath}', ...)`);
            console.error(e);
            
            console.groupCollapsed(`Debug information`);
            console.log(`Data being saved:`);
            console.dir(data);
            console.groupEnd();
            throw e;
        }
        data.id = docRef.id;
        return data;
    }
    
    async read<T extends Storable>(docPath : string): Promise<T> {
        let firestore = this.store.firestore;
        let docRef = firestore.doc(docPath);
        let snapshot : firebase.firestore.DocumentSnapshot;

        try {
            snapshot = await this.txn.get(docRef);
        } catch (e) {
            console.error(`Caught error during datastore transaction.read('${docPath}')`);
            console.error(e);
            
            console.groupCollapsed('Debug Details');
            console.dir(`Object view of error:`);
            console.dir(e);
            console.groupEnd();
            throw e;
        }
        
        return snapshot.data() as T;
    }
    
    async update<T extends Storable>(docPath : string, data : T): Promise<void> {
        let firestore = this.store.firestore;
        let docRef = firestore.doc(docPath);
        
        try {
            await this.txn.update(docRef, data);
        } catch (e) {
            console.error(`Caught error during datastore transaction.update('${docPath}', ...)`);
            console.error(e);

            console.groupCollapsed(`Debug information`);
            console.dir(`Object view of error:`);
            console.dir(e);
            console.log(`Data being updated:`);
            console.dir(data);
            console.groupEnd();
            throw e;
        }
    }

    async set<T extends Storable>(docPath : string, data : T): Promise<void> {
        let firestore = this.store.firestore;
        let docRef = firestore.doc(docPath);

        try {
            await this.txn.set(docRef, data);
        } catch (e) {
            console.error(`Caught error during datastore transaction.set('${docPath}', ...)`);
            console.error(e);

            console.groupCollapsed(`Debug information`);
            console.dir(`Object view of error:`);
            console.dir(e);
            console.log(`Data being set:`);
            console.dir(data);
            console.groupEnd();
            throw e;
        }
        
    }

    async delete(docPath : string) {
        let firestore = this.store.firestore;
        let docRef = firestore.doc(docPath);
        this.txn.delete(docRef);
    }

    async readAll(docPaths : string[]): Promise<any[]> {
        let firestore = this.store.firestore;
        let docRefs = docPaths.map(docPath => firestore.doc(docPath));
        let snapshots = await Promise.all(docRefs.map(x => this.txn.get(x)));
        return snapshots.map(x => x.data());
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

function printError(error : any, operationName : string, data? : any) {

    console.error(`* Caught error during ${operationName}:`);
    console.error(error);

    console.info(`* Debug information`);
    console.info(`* Object view of error:`);
    console.dir(error);
    console.log(`* Data being set:`);
    console.dir(data);
    console.log();
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
        return await this.firestore.runTransaction(async $t => await handler(new FbTransaction(this, $t)));
    }
    
    async read<T extends Storable>(docPath : string): Promise<T> {
        let docRef = this.firestore.doc(docPath);
        let snap : firebase.firestore.DocumentSnapshot;
        
        try {
            snap = await docRef.get();
        } catch (e) {
            handleError(e, `datastore.read('${docPath}', ...)`);
        }

        let t = snap.data() as T;
        if (t) 
            t.id = docRef.id;
        return t;
    }

    query<T extends Storable>(collectionPath : string): Query<T> {
        return new FbQuery(this.firestore.collection(collectionPath));
    }

    async listAll<T extends Storable>(collectionPath : string, params? : CollectionParams): Promise<T[]> {

        let collectionRef : firebase.firestore.Query = this.firestore.collection(collectionPath);

        if (params?.order)
            collectionRef = collectionRef.orderBy(params?.order?.field, params?.order?.direction);
            
        if (params?.limit !== undefined && params?.limit !== null)
            collectionRef = collectionRef.limit(params?.limit);

        if (params?.startAfter)
            collectionRef = collectionRef.startAfter(this.firestore.doc(params?.startAfter));

        let snap : firebase.firestore.QuerySnapshot;
        
        try {
            snap = await collectionRef.get();
        } catch (e) {
            handleError(e, `datastore.listAll('${collectionPath}', ...)`);
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
        try {
            await this.firestore.doc(docPath).set(data, { merge: true });
        } catch (e) {
            handleError(e, `datastore.update('${docPath}', ...)`);
        }
    }
    
    async delete(docPath : string): Promise<void> {
        try {
            await this.firestore.doc(docPath).delete();
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

            console.info('Debug Details');
            console.info(`Object view of error:`);
            console.dir(e);
            throw e;
        }

        if (!data)
            throw new Error(`No such object ${primaryKey}`);
        
        try {
            await Promise.all(mirrorKeys.map(key => txn.set(key, data)));
        } catch (e) {
            console.error(`Caught error while mirroring content from '${primaryKey}' to ${mirrorKeys.length} keys: ${mirrorKeys.join(', ')}`);
            console.error(e);
            console.info('Debug Details');
            console.info(`Object view of error:`);
            console.dir(e);
            console.log(`The data being mirrored:`);
            console.dir(data);
            throw e;
        }
    }

    watch<T extends Storable>(docPath: string): Observable<T> {
        let doc = this.firestore.doc(docPath);
        let unsub : () => void;
        return lazyConnection<T>({
            start: (subject) => unsub = doc.onSnapshot(snap => subject.next(<T>snap.data())),
            stop: () => unsub()
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
            start: (subject) => unsub = collection.onSnapshot(snap => subject.next(<T[]>snap.docs.map(x => x.data()))),
            stop: () => unsub()
        });
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

            console.info('Debug Details');
            console.info(`Object view of error:`);
            console.dir(e);
            throw e;
        }

        if (!data)
            throw new Error(`No such object ${primaryKey}`);
        
        try {
            await Promise.all(mirrorRefs.map(ref => ref.set(data)));
        } catch (e) {
            console.error(`Caught error while mirroring content from '${primaryKey}' to ${mirrorKeys.length} keys: ${mirrorKeys.join(', ')}`);
            console.error(e);
            console.info('Debug Details');
            console.info(`Object view of error:`);
            console.dir(e);
            console.info(`The data being mirrored:`);
            console.dir(data);
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
                console.info('Debug Details');
                console.info(`Object view of error:`);
                console.dir(e);
                console.info(`The data being written:`);
                console.dir(data);
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