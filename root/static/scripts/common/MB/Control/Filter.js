/*
   This file is part of MusicBrainz, the open internet music database.
   Copyright (C) 2012 Lukas Lalinsky

   This program is free software; you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation; either version 2 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program; if not, write to the Free Software
   Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.

*/

MB.Control.FilterButton = function () {
    var self = MB.Object ();

    self.$filter = $('#filter');
    self.state = $.cookie ('filter') == '1' ? true : false;

    $('.filter-button').bind ('click.mb', function () {
        if (self.state) {
            self.$filter.hide ('fast');
            self.state = false;
        }
        else {
            self.$filter.show ('fast');
            self.state = true;
        }
        $.cookie ('filter', self.state ? '1' : '', { path: '/' });
        return false;
    });

    if (self.state) {
        self.$filter.show ();
    }
    else {
        self.$filter.hide ();
    }

    return self;
}

$(document).ready (function() {
    MB.Control.filter_button = MB.Control.FilterButton ();
});
