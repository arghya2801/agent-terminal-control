export namespace main {
	
	export class FileFilter {
	    name: string;
	    extensions: string[];
	
	    static createFrom(source: any = {}) {
	        return new FileFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.extensions = source["extensions"];
	    }
	}

}

export namespace pty {
	
	export class Options {
	    cwd: string;
	    cols: number;
	    rows: number;
	    initialCommand: string;
	    shell: string;
	    noProfile: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Options(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cwd = source["cwd"];
	        this.cols = source["cols"];
	        this.rows = source["rows"];
	        this.initialCommand = source["initialCommand"];
	        this.shell = source["shell"];
	        this.noProfile = source["noProfile"];
	    }
	}
	export class Stats {
	    bytesOut: number;
	    sends: number;
	    sendsOverThreshold: number;
	    inflight: number;
	    pausedCount: number;
	
	    static createFrom(source: any = {}) {
	        return new Stats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.bytesOut = source["bytesOut"];
	        this.sends = source["sends"];
	        this.sendsOverThreshold = source["sendsOverThreshold"];
	        this.inflight = source["inflight"];
	        this.pausedCount = source["pausedCount"];
	    }
	}

}

