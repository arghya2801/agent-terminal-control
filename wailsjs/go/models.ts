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
	export class Hit {
	    session: string;
	    role: string;
	    snippet: string;
	    time: string;
	
	    static createFrom(source: any = {}) {
	        return new Hit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session = source["session"];
	        this.role = source["role"];
	        this.snippet = source["snippet"];
	        this.time = source["time"];
	    }
	}
	export class Turn {
	    role: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new Turn(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.text = source["text"];
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

