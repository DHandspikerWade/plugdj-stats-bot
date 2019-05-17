import { User, Media } from "plugapi";

export interface IStorage {
    cleanup(): void;
    newDj(dj:User.DJ): void;
    insertPlay(room: string, media: Media, score: any, user: User.DJ): boolean;
    newSong(media: Media): void;
}

export interface IConfigStorage extends IStorage {
    getConfig(key: string, callback: (value: any) => void): Promise<any>
    setConfig(key: string, value: any): Promise<any>
}